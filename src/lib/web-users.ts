import { randomInt } from "node:crypto";
import sql from "@/lib/sql";
import { hashPassword, verifyPassword } from "@/lib/password";
import type { Role } from "@/lib/roles";

/**
 * Dashboard accounts (migration 0045) — the Chief Manager and HR Manager
 * logins. The Super Admin is not a row: it is the ADMIN_PASSWORD.
 *
 * Node runtime only (postgres.js, scrypt). The Edge middleware never reads
 * this table: the role travels in the signed cookie, and a revoked account is
 * stopped by revoking its sessions, which the middleware already checks.
 */

export type WebRole = Exclude<Role, "super">;

export interface WebUser {
  id: string;
  name: string;
  role: WebRole;
  phone: string | null;
  email: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const missing = (e: unknown) => (e as { code?: string })?.code === "42P01";

/** Ten characters a person can read off a phone and type: no 0/O, 1/l/I. */
export function generatePassword(length = 10): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < length; i++) out += chars[randomInt(chars.length)];
  return out;
}

export async function listWebUsers(): Promise<{ users: WebUser[]; unavailable: boolean }> {
  try {
    const rows = await sql<
      { id: string; name: string; role: WebRole; phone: string | null; email: string | null; revoked_at: Date | null; created_at: Date }[]
    >`select id, name, role, phone, email, revoked_at, created_at from web_users order by revoked_at nulls first, name`;
    return {
      unavailable: false,
      users: rows.map((r) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        phone: r.phone,
        email: r.email,
        revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
        createdAt: new Date(r.created_at).toISOString(),
      })),
    };
  } catch (e) {
    if (!missing(e)) throw e;
    return { users: [], unavailable: true };
  }
}

/** Creates an account with a fresh password; returns it once, to be shown and sent. */
export async function createWebUser(input: {
  name: string;
  role: WebRole;
  phone?: string | null;
  email?: string | null;
}): Promise<{ user: WebUser; password: string }> {
  const name = input.name.replace(/\s+/g, " ").trim();
  if (!name) throw new Error("Give the person's name.");
  if (input.role !== "chief" && input.role !== "hr") throw new Error("Pick a role.");
  const password = generatePassword();
  const hash = await hashPassword(password);
  try {
    const [r] = await sql<{ id: string; created_at: Date }[]>`
      insert into web_users (name, role, phone, email, password_hash)
      values (${name}, ${input.role}, ${input.phone?.trim() || null}, ${input.email?.trim() || null}, ${hash})
      returning id, created_at`;
    return {
      password,
      user: {
        id: r.id,
        name,
        role: input.role,
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        revokedAt: null,
        createdAt: new Date(r.created_at).toISOString(),
      },
    };
  } catch (e) {
    if ((e as { code?: string })?.code === "23505") throw new Error(`There is already an account named "${name}".`);
    throw e;
  }
}

/** A new password for an account; every device it is signed in on is signed out. */
export async function resetWebUserPassword(id: string): Promise<{ user: WebUser; password: string } | null> {
  const password = generatePassword();
  const hash = await hashPassword(password);
  const rows = await sql<
    { id: string; name: string; role: WebRole; phone: string | null; email: string | null; revoked_at: Date | null; created_at: Date }[]
  >`update web_users set password_hash = ${hash}, updated_at = now() where id = ${id}::uuid
    returning id, name, role, phone, email, revoked_at, created_at`;
  if (!rows[0]) return null;
  await revokeUserSessions(id);
  const r = rows[0];
  return {
    password,
    user: {
      id: r.id,
      name: r.name,
      role: r.role,
      phone: r.phone,
      email: r.email,
      revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
    },
  };
}

/** Revoke (or restore) an account. Revoking signs it out everywhere at once. */
export async function setWebUserRevoked(id: string, revoked: boolean): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update web_users set revoked_at = ${revoked ? sql`now()` : null}, updated_at = now()
     where id = ${id}::uuid returning id`;
  if (!rows[0]) return false;
  if (revoked) await revokeUserSessions(id);
  return true;
}

async function revokeUserSessions(userId: string): Promise<void> {
  await sql`update web_sessions set revoked_at = now() where user_id = ${userId}::uuid and revoked_at is null`.catch(
    (e) => console.warn("could not revoke the account's sessions:", e)
  );
}

/**
 * A personal login: name (case and spacing ignored) + password, on an account
 * that is not revoked. A dummy verification keeps the timing the same when the
 * name is unknown.
 */
export async function checkWebLogin(name: string, password: string): Promise<{ id: string; name: string; role: WebRole } | null> {
  const key = name.replace(/\s+/g, " ").trim().toLowerCase();
  if (!key || !password) return null;
  const rows = await sql<{ id: string; name: string; role: WebRole; password_hash: string; revoked_at: Date | null }[]>`
    select id, name, role, password_hash, revoked_at from web_users where lower(name) = ${key}`.catch((e) => {
    if (!missing(e)) throw e;
    return [];
  });
  const u = rows[0];
  if (!u) {
    await verifyPassword(password, `scrypt$16384$${"00".repeat(16)}$${"00".repeat(64)}`).catch(() => false);
    return null;
  }
  if (u.revoked_at) return null;
  return (await verifyPassword(password, u.password_hash)) ? { id: u.id, name: u.name, role: u.role } : null;
}

/** Who a signed-in session belongs to — for the greeting. Null for the Super Admin. */
export async function sessionUserName(sid: string): Promise<string | null> {
  const rows = await sql<{ name: string }[]>`
    select u.name from web_sessions s join web_users u on u.id = s.user_id where s.id = ${sid}::uuid`.catch(() => []);
  return rows[0]?.name ?? null;
}
