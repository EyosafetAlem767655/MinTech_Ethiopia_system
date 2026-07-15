import { NextRequest, NextResponse } from "next/server";
import sql, { first, isUuid } from "@/lib/sql";
import { hashPassword, normalizeFullName, passwordProblem } from "@/lib/password";
import { isPositionKey } from "@/lib/positions";
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
    await sql`update telegram_users set positions = ${positions} where id = ${user.id}`;
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

  if (body.forceLogout === true) await revokeUserSessions(user.id);

  if (body.unlock === true) {
    await sql`update telegram_users set failed_attempts = 0, locked_until = null where id = ${user.id}`;
  }

  const safe = first(await sql`
    select id as _id, full_name as "fullName", positions, active, session_epoch as "sessionEpoch",
           chat_id as "chatId", logged_in as "loggedIn", last_login_at as "lastLoginAt",
           last_seen_at as "lastSeenAt", locked_until as "lockedUntil", note
      from telegram_users where id = ${user.id}
  `);
  return NextResponse.json({ ok: true, user: safe });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const user = first(await sql`select id from telegram_users where id = ${params.id}`);
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await revokeUserSessions(params.id);
  await sql`delete from telegram_users where id = ${params.id}`;
  return NextResponse.json({ ok: true });
}
