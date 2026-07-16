import { NextRequest, NextResponse } from "next/server";
import sql, { first } from "@/lib/sql";
import { hashPassword, normalizeFullName, passwordProblem } from "@/lib/password";
import { isPositionKey } from "@/lib/positions";

export const dynamic = "force-dynamic";

export async function GET() {
  // password_hash must never leave the server, so it is never selected.
  const users = await sql`
    select id as _id, full_name as "fullName", positions, active,
           session_epoch as "sessionEpoch", chat_id as "chatId", logged_in as "loggedIn",
           last_login_at as "lastLoginAt", last_seen_at as "lastSeenAt",
           locked_until as "lockedUntil", note, created_at as "createdAt"
      from telegram_users
     order by full_name asc
  `;
  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const fullName = String(body.fullName || "").trim();
  const password = String(body.password || "");
  const positions: string[] = Array.isArray(body.positions) ? body.positions.filter(isPositionKey) : [];

  if (!fullName) return NextResponse.json({ error: "Full name is required." }, { status: 400 });
  if (positions.length === 0) return NextResponse.json({ error: "Pick at least one position." }, { status: 400 });

  const pwProblem = passwordProblem(password);
  if (pwProblem) return NextResponse.json({ error: pwProblem }, { status: 400 });

  const fullNameKey = normalizeFullName(fullName);
  const existing = first(await sql`select 1 from telegram_users where full_name_key = ${fullNameKey}`);
  if (existing) {
    return NextResponse.json({ error: "An employee with that full name already exists." }, { status: 409 });
  }

  const [user] = await sql<{ id: string }[]>`
    insert into telegram_users (full_name, full_name_key, positions, password_hash, active, session_epoch, logged_in, note, created_by)
    values (${fullName}, ${fullNameKey}, ${positions}, ${await hashPassword(password)}, true, 1, false,
            ${String(body.note || "") || null}, 'dashboard')
    returning id
  `;
  return NextResponse.json({ ok: true, id: user.id });
}
