import sql, { first, jsonb } from "@/lib/sql";
import { normalizeFullName, verifyPassword } from "@/lib/password";

/**
 * Telegram bot authentication.
 *
 * Ported from Mongoose to SQL with the security semantics deliberately
 * unchanged: same two-layer lockout, same constant-time-ish unknown-user path,
 * and the same sessionEpoch mechanism that makes revocation instant without any
 * expiry job. If you change anything here, re-run the auth verification suite.
 */

/** Wrong-password attempts before the account is temporarily locked. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

/** Separate, stricter throttle on the chat itself, so a flood of guesses
 *  against many different names still gets stopped. */
const MAX_CHAT_ATTEMPTS = 8;
const CHAT_LOCKOUT_MINUTES = 30;

export interface BotUser {
  id: string;
  full_name: string;
  full_name_key: string;
  positions: string[];
  password_hash: string;
  active: boolean;
  session_epoch: number;
  chat_id: string | null;
  logged_in: boolean;
  failed_attempts: number;
  locked_until: Date | null;
}

export type LoginResult =
  | { ok: true; user: BotUser }
  | { ok: false; reason: "invalid" | "locked" | "inactive"; retryAfterMinutes?: number };

/**
 * Verifies a full name + password pair.
 *
 * "invalid" is returned both for an unknown name and for a wrong password, so
 * the bot never reveals which employees exist. The unknown-name path still runs
 * a scrypt verification against a dummy hash to keep the timing flat.
 */
export async function attemptLogin(fullName: string, password: string): Promise<LoginResult> {
  const key = normalizeFullName(fullName);
  const user = first(
    await sql<BotUser[]>`select * from telegram_users where full_name_key = ${key}`
  );

  if (!user) {
    await verifyPassword(password, `scrypt$16384$${"00".repeat(16)}$${"00".repeat(64)}`).catch(() => false);
    return { ok: false, reason: "invalid" };
  }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    return {
      ok: false,
      reason: "locked",
      retryAfterMinutes: Math.max(
        1,
        Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000)
      ),
    };
  }

  if (!user.active) return { ok: false, reason: "inactive" };

  const good = await verifyPassword(password, user.password_hash).catch(() => false);
  if (!good) {
    // Increment and lock atomically, so parallel guesses can't race past the cap.
    const [row] = await sql<{ failed_attempts: number; locked_until: Date | null }[]>`
      update telegram_users
         set failed_attempts = case
               when failed_attempts + 1 >= ${MAX_FAILED_ATTEMPTS} then 0
               else failed_attempts + 1 end,
             locked_until = case
               when failed_attempts + 1 >= ${MAX_FAILED_ATTEMPTS}
               then now() + (${LOCKOUT_MINUTES} || ' minutes')::interval
               else locked_until end
       where id = ${user.id}
       returning failed_attempts, locked_until
    `;
    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
      return { ok: false, reason: "locked", retryAfterMinutes: LOCKOUT_MINUTES };
    }
    return { ok: false, reason: "invalid" };
  }

  const [fresh] = await sql<BotUser[]>`
    update telegram_users
       set failed_attempts = 0, locked_until = null
     where id = ${user.id}
     returning *
  `;
  return { ok: true, user: fresh };
}

/** Binds a verified user to this chat. Any previous chat binding is replaced. */
export async function bindSession(user: BotUser, chatId: string): Promise<BotUser> {
  const [fresh] = await sql<BotUser[]>`
    update telegram_users
       set chat_id = ${chatId}, logged_in = true, last_login_at = now(), last_seen_at = now()
     where id = ${user.id}
     returning *
  `;
  return fresh;
}

/**
 * Re-checks the stored session against the live user row on EVERY bot action.
 *
 * A deactivated user, a password reset, or an admin force-logout all bump
 * session_epoch, so the stale session is rejected right here — no expiry job, no
 * token blacklist. A login from another device moves chat_id, which evicts the
 * old chat.
 */
export async function resolveSession(session: {
  chatId: string;
  auth?: { userId?: string; sessionEpoch?: number } | null;
}): Promise<BotUser | null> {
  const auth = session.auth;
  if (!auth?.userId) return null;

  const user = first(await sql<BotUser[]>`select * from telegram_users where id = ${auth.userId}`);
  if (!user || !user.active || !user.logged_in) return null;
  if (Number(user.session_epoch) !== Number(auth.sessionEpoch)) return null;
  if (user.chat_id && user.chat_id !== session.chatId) return null;

  return user;
}

export async function touchLastSeen(userId: string) {
  await sql`update telegram_users set last_seen_at = now() where id = ${userId}`.catch(() => {});
}

/** Clears the in-memory session object. Caller is responsible for persisting. */
export function clearAuth(session: any) {
  session.auth = undefined;
  session.mode = "unknown";
  session.state = "idle";
  session.draft = undefined;
  session.capture = undefined;
  // Multi-step scratch state must go too. Resetting `state` alone already stops
  // a flow resuming, but leaving these behind strands the previous user's
  // half-typed report in the session row of a shared phone.
  session.receiptScan = undefined;
  session.assetFlow = undefined;
  session.loginName = undefined;
  session.history = [];
}

export async function logoutUser(session: any) {
  if (session.auth?.userId) {
    await sql`update telegram_users set logged_in = false where id = ${session.auth.userId}`.catch(() => {});
  }
  clearAuth(session);
}

/**
 * Revokes every live bot session for a user. Called on password change,
 * deactivation, force-logout and delete. Bumping session_epoch is what makes
 * the next inbound message from that chat fail resolveSession().
 */
export async function revokeUserSessions(userId: string) {
  const [user] = await sql<{ chat_id: string | null }[]>`
    update telegram_users
       set session_epoch = session_epoch + 1, logged_in = false
     where id = ${userId}
     returning chat_id
  `;
  if (user?.chat_id) {
    await sql`
      update telegram_sessions
         set auth = null, capture = null, draft = null,
             state = 'idle', mode = 'unknown', history = '[]'::jsonb
       where chat_id = ${user.chat_id}
    `.catch(() => {});
  }
}

/* ─────────────────── Chat-level guess throttle (in-session) ───────────────── */

export function chatLockRemainingMinutes(session: any): number {
  const until = session.loginLockedUntil ? new Date(session.loginLockedUntil).getTime() : 0;
  if (until <= Date.now()) return 0;
  return Math.max(1, Math.ceil((until - Date.now()) / 60000));
}

export function registerFailedChatAttempt(session: any) {
  session.loginAttempts = (session.loginAttempts || 0) + 1;
  if (session.loginAttempts >= MAX_CHAT_ATTEMPTS) {
    session.loginLockedUntil = new Date(Date.now() + CHAT_LOCKOUT_MINUTES * 60000);
    session.loginAttempts = 0;
  }
}

export function resetChatAttempts(session: any) {
  session.loginAttempts = 0;
  session.loginLockedUntil = undefined;
}

/* ─────────────────────────────── Audit trail ─────────────────────────────── */

export type BotActivityAction =
  | "start" | "external_registered" | "login_success" | "login_failed" | "login_locked"
  | "logout" | "session_revoked" | "menu_select" | "unauthorized" | "submission"
  | "submission_rejected" | "reminder_sent" | "purchase_decision" | "chat_question" | "error";

export async function logActivity(entry: {
  chatId: string;
  actor?: string;
  userId?: string;
  positions?: string[];
  audience?: "internal" | "external" | "unknown";
  action: BotActivityAction;
  detail?: string;
  ok?: boolean;
  meta?: Record<string, unknown>;
}) {
  // Audit logging must never break a bot reply.
  try {
    await sql`
      insert into bot_activity (chat_id, actor, user_id, positions, audience, action, detail, ok, meta)
      values (${entry.chatId}, ${entry.actor || "Unknown"}, ${entry.userId ?? null},
              ${entry.positions ?? []}, ${entry.audience || "unknown"}, ${entry.action},
              ${entry.detail ?? null}, ${entry.ok !== false},
              ${entry.meta ? jsonb(entry.meta) : null})
    `;
  } catch (e) {
    console.error("logActivity failed:", e);
  }
}

/** YYYY-MM-DD in East Africa Time (UTC+3), which is where the plant runs. */
export function eatDateKey(d: Date = new Date()): string {
  return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}
