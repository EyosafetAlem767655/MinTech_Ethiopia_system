import sql, { first } from "@/lib/sql";

/**
 * Telegram conversation state. The webhook mutates a plain object in memory and
 * calls saveSession() to persist — this mirrors the old Mongoose-document flow
 * (load → mutate → save) so the large webhook handler barely changes. jsonb
 * columns (auth/external/capture/draft/history) replace Schema.Types.Mixed, so
 * there is no markModified() to remember.
 */
export interface Session {
  id?: string;
  chatId: string;
  userName?: string | null;
  mode: string;
  state: string;
  auth?: any;
  external?: any;
  loginName?: string | null;
  loginAttempts?: number;
  loginLockedUntil?: Date | null;
  capture?: any;
  draft?: any;
  /** 5-minute correction window: last submission ref + any in-progress edit. */
  editState?: any;
  /** Sales receipt-scan flow scratch state (collected image ids + working draft). */
  receiptScan?: any;
  /** Guided asset-report flow scratch state (kind + step + draft columns). */
  assetFlow?: any;
  history: { role: "user" | "assistant"; content: string }[];
}

function rowToSession(r: any): Session {
  return {
    id: r.id,
    chatId: r.chat_id,
    userName: r.user_name,
    mode: r.mode,
    state: r.state,
    auth: r.auth ?? undefined,
    external: r.external ?? undefined,
    loginName: r.login_name,
    loginAttempts: r.login_attempts ?? 0,
    loginLockedUntil: r.login_locked_until,
    capture: r.capture ?? undefined,
    draft: r.draft ?? undefined,
    editState: r.edit_state ?? undefined,
    receiptScan: r.receipt_scan ?? undefined,
    assetFlow: r.asset_flow ?? undefined,
    history: r.history ?? [],
  };
}

export async function loadSession(chatId: string, userName: string): Promise<Session> {
  const existing = first<any>(await sql`select * from telegram_sessions where chat_id = ${chatId}`);
  if (existing) return rowToSession(existing);

  const [created] = await sql`
    insert into telegram_sessions (chat_id, user_name, mode, state, history)
    values (${chatId}, ${userName}, 'unknown', 'idle', '[]'::jsonb)
    on conflict (chat_id) do update set user_name = excluded.user_name
    returning *
  `;
  return rowToSession(created);
}

async function writeSession(s: Session): Promise<void> {
  await sql`
    update telegram_sessions set
      user_name          = ${s.userName ?? null},
      mode               = ${s.mode ?? "unknown"},
      state              = ${s.state ?? "idle"},
      auth               = ${s.auth ? sql.json(s.auth) : null},
      external           = ${s.external ? sql.json(s.external) : null},
      login_name         = ${s.loginName ?? null},
      login_attempts     = ${s.loginAttempts ?? 0},
      login_locked_until = ${s.loginLockedUntil ?? null},
      capture            = ${s.capture ? sql.json(s.capture) : null},
      draft              = ${s.draft ? sql.json(s.draft) : null},
      edit_state         = ${s.editState ? sql.json(s.editState) : null},
      receipt_scan       = ${s.receiptScan ? sql.json(s.receiptScan) : null},
      asset_flow         = ${s.assetFlow ? sql.json(s.assetFlow) : null},
      history            = ${sql.json(s.history ?? [])}
    where chat_id = ${s.chatId}
  `;
}

let _healedSessionCols = false;

export async function saveSession(s: Session): Promise<void> {
  try {
    await writeSession(s);
  } catch (e) {
    // The optional jsonb columns arrive in later migrations — edit_state (0005),
    // receipt_scan (0008) and asset_flow (0013). If a deployment is running ahead
    // of its migrations, Postgres raises undefined_column (42703). We MUST NOT
    // silently drop them: these hold the multi-step scratch state for the guided
    // sales and asset flows, so dropping one makes that flow reset to the menu
    // between messages. Instead self-heal — add the columns, then persist — so the
    // features work even when the migration hasn't been applied by hand.
    if ((e as { code?: string })?.code !== "42703") throw e;
    if (!_healedSessionCols) {
      await sql`alter table telegram_sessions add column if not exists edit_state jsonb`.catch(() => {});
      await sql`alter table telegram_sessions add column if not exists receipt_scan jsonb`.catch(() => {});
      await sql`alter table telegram_sessions add column if not exists asset_flow jsonb`.catch(() => {});
      _healedSessionCols = true;
    }
    await writeSession(s);
  }
}
