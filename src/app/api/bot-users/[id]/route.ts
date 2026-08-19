import { NextRequest, NextResponse } from "next/server";
import sql, { first, isUuid } from "@/lib/sql";
import { hashPassword, normalizeFullName, passwordProblem } from "@/lib/password";
import { isCapabilityKey, isPositionKey } from "@/lib/positions";
import { revokeUserSessions } from "@/lib/bot-auth";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));

  const user = first(await sql<{ id: string; active: boolean }[]>`
    select id, active from telegram_users where id = ${params.id}
  `);
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (typeof body.fullName === "string" && body.fullName.trim()) {
    const fullName = body.fullName.trim();
    const fullNameKey = normalizeFullName(fullName);
    const clash = first(await sql`
      select 1 from telegram_users where full_name_key = ${fullNameKey} and id <> ${user.id}
    `);
    if (clash) return NextResponse.json({ error: "Another employee already uses that full name." }, { status: 409 });
    await sql`update telegram_users set full_name = ${fullName}, full_name_key = ${fullNameKey} where id = ${user.id}`;
  }

  if (Array.isArray(body.positions)) {
    const positions = body.positions.filter(isPositionKey);
    if (positions.length === 0) return NextResponse.json({ error: "Pick at least one position." }, { status: 400 });
    // Read the current positions so we only disrupt the bot session when the role
    // set actually changed. A live session caches the role menu, so on any change
    // we bump session_epoch — the next bot action fails resolveSession and the
    // user is forced to sign out and /start again, picking up the new positions.
    const before = first(await sql<{ positions: string[] }[]>`
      select positions from telegram_users where id = ${user.id}
    `);
    await sql`update telegram_users set positions = ${positions} where id = ${user.id}`;
    const changed =
      !before ||
      before.positions.length !== positions.length ||
      [...positions].sort().join("|") !== [...before.positions].sort().join("|");
    if (changed) await revokeUserSessions(user.id);
  }

  if (Array.isArray(body.capabilities)) {
    const caps = body.capabilities.filter(isCapabilityKey);
    // An empty array is meaningful: it clears the override and returns the
    // employee to their positions' defaults. It must never mean "no buttons",
    // which would leave them with an empty menu and no way to report.
    const before = first(await sql<{ capabilities: string[] | null }[]>`
      select capabilities from telegram_users where id = ${user.id}
    `);
    await sql`update telegram_users set capabilities = ${caps.length > 0 ? caps : null} where id = ${user.id}`;
    const prev = before?.capabilities || [];
    const changed = prev.length !== caps.length || [...caps].sort().join("|") !== [...prev].sort().join("|");
    // Same reason as positions: a live session caches the keyboard.
    if (changed) await revokeUserSessions(user.id);
  }

  if (typeof body.note === "string") {
    await sql`update telegram_users set note = ${body.note || null} where id = ${user.id}`;
  }

  // A password change invalidates every existing bot session for this user.
  if (typeof body.password === "string" && body.password) {
    const problem = passwordProblem(body.password);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    await sql`
      update telegram_users
         set password_hash = ${await hashPassword(body.password)}, failed_attempts = 0, locked_until = null
       where id = ${user.id}
    `;
    await revokeUserSessions(user.id);
  }

  if (typeof body.active === "boolean" && body.active !== user.active) {
    await sql`update telegram_users set active = ${body.active} where id = ${user.id}`;
    if (!body.active) await revokeUserSessions(user.id);
  }

  // Restore an archived employee: clear the archive marker and reactivate. Their
  // full submission history was never removed, so it simply reconnects.
  if (body.restore === true) {
    await sql`update telegram_users set archived_at = null, active = true where id = ${user.id}`;
  }

  if (body.forceLogout === true) await revokeUserSessions(user.id);

  if (body.unlock === true) {
    await sql`update telegram_users set failed_attempts = 0, locked_until = null where id = ${user.id}`;
  }

  const safe = first(await sql`
    select id as _id, full_name as "fullName", positions, active, session_epoch as "sessionEpoch",
           chat_id as "chatId", logged_in as "loggedIn", last_login_at as "lastLoginAt",
           last_seen_at as "lastSeenAt", locked_until as "lockedUntil", note, archived_at as "archivedAt"
      from telegram_users where id = ${user.id}
  `);
  return NextResponse.json({ ok: true, user: safe });
}

/**
 * By default "Remove" is a soft archive, not a hard delete. The row is kept so
 * the person's name, positions and full submission history stay visible on the
 * dashboard; the session is revoked and the account is deactivated so they can no
 * longer sign into the bot. Restore is handled by PATCH { restore: true }.
 *
 * DELETE ...?hard=true performs a true delete of the employee record. This is
 * safe for history: every report table references telegram_users(id) with
 * ON DELETE SET NULL and denormalises full_name/positions onto each row, so the
 * submitted data stays — only the person's account record is removed.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const user = first(await sql<{ id: string; chat_id: string | null }[]>`
    select id, chat_id from telegram_users where id = ${params.id}
  `);
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const hard = req.nextUrl.searchParams.get("hard") === "true";

  await revokeUserSessions(params.id);

  if (hard) {
    // Drop the live bot session row (keyed by chat_id, no FK), then delete the
    // employee. Report rows keep their data via ON DELETE SET NULL.
    if (user.chat_id) {
      await sql`delete from telegram_sessions where chat_id = ${user.chat_id}`.catch(() => {});
    }
    await sql`delete from telegram_users where id = ${params.id}`;
    return NextResponse.json({ ok: true, deleted: true });
  }

  await sql`
    update telegram_users
       set active = false, archived_at = coalesce(archived_at, now())
     where id = ${params.id}
  `;
  return NextResponse.json({ ok: true, archived: true });
}
