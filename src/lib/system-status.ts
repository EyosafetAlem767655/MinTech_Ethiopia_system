import sql from "@/lib/sql";
import { escapeHtml, INFO_KINDS } from "@/lib/errors";
import { isOverdue, JOBS, latestJobRuns, type JobRow } from "@/lib/system-jobs";
import { countMovable, daysUntil, LOG_KEEP_MONTHS, nextQuarterlyRun, STATS_KEEP_MONTHS } from "@/lib/lifecycle";
import { undecidedPhotos } from "@/lib/storage";

/**
 * What the System Admin button in the bot shows, and the System section of the
 * administrators' morning summary.
 *
 * Everything here is READ: errors, sizes, the job log, the archive plan. The
 * only thing an admin can change from the bot is marking errors seen. Each
 * view is one Telegram message in HTML mode, so every piece of text that came
 * from the database is escaped — one stray "<" in an error message would make
 * Telegram refuse the whole card.
 */

const MB = 1024 * 1024;
const mb = (bytes: number) => `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;

/** The Supabase plan's database size, for the percentage. 500 MB is the free tier. */
export function dbLimitBytes(): number {
  const raw = Number(process.env.SUPABASE_DB_LIMIT_MB);
  return (Number.isFinite(raw) && raw > 0 ? raw : 500) * MB;
}

/** EAT wall-clock for a timestamp, short: "7 Oct 06:30". */
function eat(d: Date): string {
  const e = new Date(d.getTime() + 3 * 3600_000);
  const mon = e.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return `${e.getUTCDate()} ${mon} ${String(e.getUTCHours()).padStart(2, "0")}:${String(e.getUTCMinutes()).padStart(2, "0")}`;
}

function ago(d: Date, now = new Date()): string {
  const mins = Math.round((now.getTime() - d.getTime()) / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const dateOnly = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/* ─────────────────────────────────── Facts ───────────────────────────────── */

export interface DatabaseFacts {
  bytes: number;
  limit: number;
  tables: { name: string; bytes: number }[];
  storage: { bytes: number; files: number } | null;
}

export async function databaseFacts(): Promise<DatabaseFacts> {
  const [{ size }] = await sql<{ size: string }[]>`select pg_database_size(current_database()) as size`;
  const tables = await sql<{ name: string; bytes: string }[]>`
    select c.relname as name, pg_total_relation_size(c.oid) as bytes
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by pg_total_relation_size(c.oid) desc
     limit 5
  `;
  // Supabase Storage keeps its index in the `storage` schema. Reading it can be
  // refused depending on the role; the photos are then simply not reported.
  const storage = await sql<{ bytes: string; files: string }[]>`
    select coalesce(sum((metadata->>'size')::bigint), 0) as bytes, count(*) as files from storage.objects
  `
    .then((r) => ({ bytes: Number(r[0]?.bytes) || 0, files: Number(r[0]?.files) || 0 }))
    .catch(() => null);
  return {
    bytes: Number(size) || 0,
    limit: dbLimitBytes(),
    tables: tables.map((t) => ({ name: t.name, bytes: Number(t.bytes) || 0 })),
    storage,
  };
}

export interface ErrorFacts {
  open: number;
  last24h: number;
  last7d: number;
  info24h: number;
  kinds: { kind: string; n: number; last: Date }[];
  newest: { kind: string; message: string; at: Date }[];
}

export async function errorFacts(): Promise<ErrorFacts> {
  const info = [...INFO_KINDS];
  try {
    const [counts] = await sql<{ open: string; d1: string; d7: string; info: string }[]>`
      select count(*) filter (where resolved_at is null and kind <> all(${info})) as open,
             count(*) filter (where created_at >= now() - interval '24 hours' and kind <> all(${info})) as d1,
             count(*) filter (where created_at >= now() - interval '7 days' and kind <> all(${info})) as d7,
             count(*) filter (where created_at >= now() - interval '24 hours' and kind = any(${info})) as info
        from system_errors
    `;
    const kinds = await sql<{ kind: string; n: string; last: string }[]>`
      select kind, count(*) as n, max(created_at) as last
        from system_errors
       where resolved_at is null and kind <> all(${info}) and created_at >= now() - interval '7 days'
       group by kind order by count(*) desc limit 6
    `;
    const newest = await sql<{ kind: string; message: string; created_at: string }[]>`
      select kind, message, created_at from system_errors
       where resolved_at is null and kind <> all(${info})
       order by created_at desc limit 5
    `;
    return {
      open: Number(counts.open) || 0,
      last24h: Number(counts.d1) || 0,
      last7d: Number(counts.d7) || 0,
      info24h: Number(counts.info) || 0,
      kinds: kinds.map((k) => ({ kind: k.kind, n: Number(k.n) || 0, last: new Date(k.last) })),
      newest: newest.map((e) => ({ kind: e.kind, message: e.message, at: new Date(e.created_at) })),
    };
  } catch (e) {
    if ((e as { code?: string })?.code !== "42P01") throw e;
    return { open: 0, last24h: 0, last7d: 0, info24h: 0, kinds: [], newest: [] };
  }
}

/** Jobs that failed last time, or are overdue — the ones that need a person. */
function jobProblems(runs: Map<string, JobRow>, now = new Date()) {
  return Object.keys(JOBS).filter((job) => {
    const last = runs.get(job);
    return isOverdue(job, last, now) || last?.ok === false;
  });
}

/* ─────────────────────────────────── Views ───────────────────────────────── */

/** The inline keyboard under every System Admin message. */
export function systemKeyboard(extra: { text: string; callback_data: string }[][] = []) {
  return {
    inline_keyboard: [
      ...extra,
      [
        { text: "🚨 Errors", callback_data: "sys:errors" },
        { text: "🗄 Database", callback_data: "sys:db" },
      ],
      [
        { text: "🔁 Jobs", callback_data: "sys:jobs" },
        { text: "📦 Archive", callback_data: "sys:archive" },
      ],
    ],
  };
}

/** The card the 🛠 System Admin button opens: one line per area. */
export async function overviewView(now = new Date()): Promise<string> {
  const [errors, db, runs] = await Promise.all([errorFacts(), databaseFacts(), latestJobRuns()]);
  const problems = jobProblems(runs, now);
  const pct = Math.round((db.bytes / db.limit) * 100);
  const next = nextQuarterlyRun(now);
  const backup = runs.get("backup");
  return (
    `🛠 <b>System Admin</b> · ${eat(now)}\n\n` +
    `🚨 Errors: <b>${errors.open}</b> open · ${errors.last24h} in 24 h\n` +
    `🗄 Database: <b>${mb(db.bytes)}</b> of ${mb(db.limit)} (${pct}%)${pct >= 80 ? " ⚠️" : ""}\n` +
    `💾 Backup: ${
      !backup ? "⚠️ never recorded" : backup.ok === false ? `❌ failed ${ago(backup.startedAt, now)}` : isOverdue("backup", backup, now) ? `⚠️ none since ${ago(backup.startedAt, now)}` : `✅ ${ago(backup.startedAt, now)}`
    }\n` +
    `🔁 Jobs: ${problems.length ? `<b>${problems.length}</b> need attention` : "all running"}\n` +
    `📦 Next archive move: ${dateOnly(next)} (in ${daysUntil(next, now)} days)\n\n` +
    `<i>Choose a section below.</i>`
  );
}

export async function errorsView(): Promise<string> {
  const f = await errorFacts();
  const kinds = f.kinds.length
    ? f.kinds.map((k) => `• <code>${escapeHtml(k.kind)}</code> ×${k.n} · last ${ago(k.last)}`).join("\n")
    : "• none";
  const newest = f.newest.length
    ? f.newest.map((e) => `• ${eat(e.at)} <code>${escapeHtml(e.kind)}</code>\n  ${escapeHtml(e.message.slice(0, 140))}`).join("\n")
    : "• none";
  return (
    `🚨 <b>Errors</b>\n\n` +
    `Open: <b>${f.open}</b> · last 24 h: ${f.last24h} · last 7 days: ${f.last7d}\n\n` +
    `<b>Open, by kind (7 days)</b>\n${kinds}\n\n` +
    `<b>Newest open</b>\n${newest}\n\n` +
    `<i>${f.info24h} informational notices in 24 h (Gemini retries and fallbacks) — counted, not pushed.</i>`
  );
}

export async function databaseView(): Promise<string> {
  const [db, runs] = await Promise.all([databaseFacts(), latestJobRuns()]);
  const pct = Math.round((db.bytes / db.limit) * 100);
  const backup = runs.get("backup");
  const archive = runs.get("archive");
  const neonBytes = Number(backup?.detail?.neonBytes) || 0;
  const neonTables = Number(backup?.detail?.neonTables) || 0;
  const archiveBytes = Number(archive?.detail?.archiveBytes) || 0;
  return (
    `🗄 <b>Database</b>\n\n` +
    `<b>Supabase</b> (live): ${mb(db.bytes)} of ${mb(db.limit)} — ${pct}%${pct >= 80 ? " ⚠️ nearly full" : ""}\n` +
    db.tables.map((t) => `• ${escapeHtml(t.name)} ${mb(t.bytes)}`).join("\n") +
    `\n\n<b>Photos</b> (Supabase Storage): ` +
    (db.storage ? `${mb(db.storage.bytes)} in ${db.storage.files} files` : "not readable from here") +
    `\n\n<b>Neon copy</b> (nightly): ` +
    (backup && neonBytes ? `${mb(neonBytes)}, ${neonTables} tables · ${ago(backup.startedAt)}` : "no size recorded yet") +
    `\n<b>Neon archive</b> (quarterly): ` +
    (archive && archiveBytes ? `${mb(archiveBytes)} · last run ${dateOnly(archive.startedAt)}` : "nothing moved yet")
  );
}

export async function jobsView(now = new Date()): Promise<string> {
  const runs = await latestJobRuns();
  const lines = Object.entries(JOBS).map(([job, meta]) => {
    const last = runs.get(job);
    let icon = "✅";
    let when = last ? `${eat(last.startedAt)} (${ago(last.startedAt, now)})` : "never";
    if (!last) icon = meta.everyHours ? "⚠️" : "▫️";
    else if (last.finishedAt === null) icon = "⏳";
    else if (last.ok === false) icon = "❌";
    else if (isOverdue(job, last, now)) {
      icon = "⚠️";
      when += " — overdue";
    }
    const summary = last?.summary ? `\n  ${escapeHtml(last.summary.slice(0, 160))}` : "";
    return `${icon} <b>${escapeHtml(meta.label)}</b> · ${when}${summary}`;
  });
  return `🔁 <b>Jobs</b>\n\n${lines.join("\n\n")}\n\n<i>⚠️ = a job that should have run and has no record. Silence counts as a failure.</i>`;
}

export async function archiveView(now = new Date()): Promise<string> {
  const [movable, runs] = await Promise.all([countMovable(now).catch(() => null), latestJobRuns()]);
  const next = nextQuarterlyRun(now);
  const last = runs.get("archive");
  const moved = (last?.detail?.moved as Record<string, number> | undefined) ?? {};
  const movedLines = Object.entries(moved)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `• ${escapeHtml(t)} ${n}`)
    .join("\n");
  const would =
    movable === null
      ? "could not be counted"
      : movable.length === 0
        ? "nothing yet"
        : `${movable.reduce((a, m) => a + m.rows, 0)} rows\n` +
          movable.slice(0, 6).map((m) => `• ${escapeHtml(m.table)} ${m.rows}`).join("\n");
  return (
    `📦 <b>Archive (Supabase → Neon)</b>\n\n` +
    `Records stay here ${STATS_KEEP_MONTHS} full months, logs ${LOG_KEEP_MONTHS}. Older ones move to the Neon archive once a quarter; ` +
    `anything still owed, in stock or undecided stays regardless.\n\n` +
    `<b>Next move:</b> ${dateOnly(next)} (in ${daysUntil(next, now)} days)\n` +
    `<b>If it ran today, it would move:</b> ${would}\n\n` +
    `<b>Last move:</b> ` +
    (last ? `${dateOnly(last.startedAt)} — ${last.ok ? "✅" : "❌"} ${escapeHtml(last.summary ?? "")}${movedLines ? `\n${movedLines}` : ""}` : "none yet")
  );
}

/**
 * The System section of the administrators' morning summary.
 *
 * Short, and only what changed or needs a person. Three days before a
 * quarterly move it also says what the move will take, so nobody is surprised
 * by rows leaving the dashboard.
 */
export async function systemDigest(now = new Date()): Promise<string> {
  try {
    const [errors, db, runs, undecided] = await Promise.all([
      errorFacts(),
      databaseFacts(),
      latestJobRuns(),
      undecidedPhotos(),
    ]);
    const lines: string[] = [];

    const backup = runs.get("backup");
    lines.push(
      !backup
        ? "💾 Backup: ⚠️ no backup has ever been recorded"
        : backup.ok === false
          ? `💾 Backup: ❌ failed — ${escapeHtml(backup.summary ?? "")}`
          : isOverdue("backup", backup, now)
            ? `💾 Backup: ⚠️ none since ${eat(backup.startedAt)}`
            : `💾 Backup: ✅ ${eat(backup.startedAt)}${backup.detail?.neonTables ? ` · ${backup.detail.neonTables} tables in Neon` : ""}`
    );

    const purge = runs.get("purge-photos");
    const waiting = undecided.reduce((a, u) => a + u.count, 0);
    lines.push(
      `🗑 Photos: ${Number(purge?.detail?.deleted) || 0} deleted` +
        (waiting ? ` · ${waiting} older than 3 months kept because still undecided` : "")
    );

    const pct = Math.round((db.bytes / db.limit) * 100);
    lines.push(`🗄 Database: ${mb(db.bytes)} (${pct}% of ${mb(db.limit)})${pct >= 80 ? " ⚠️" : ""}`);

    lines.push(
      `🚨 Errors: ${errors.open} open, ${errors.last24h} in 24 h` +
        (errors.kinds.length ? ` (${errors.kinds.slice(0, 3).map((k) => escapeHtml(k.kind)).join(", ")})` : "") +
        (errors.info24h ? ` · ${errors.info24h} informational` : "")
    );

    const problems = jobProblems(runs, now).filter((j) => j !== "backup");
    if (problems.length) lines.push(`🔁 Needs attention: ${problems.map((j) => escapeHtml(JOBS[j].label)).join(", ")}`);

    const next = nextQuarterlyRun(now);
    const days = daysUntil(next, now);
    if (days <= 3) {
      const movable = await countMovable(next).catch(() => null);
      const total = movable?.reduce((a, m) => a + m.rows, 0) ?? 0;
      lines.push(
        `⏰ <b>Archive move ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}</b> (${dateOnly(next)}): ` +
          (movable === null ? "size not available" : total === 0 ? "nothing old enough to move" : `${total} rows will move to Neon`)
      );
    } else {
      lines.push(`📦 Next archive move: ${dateOnly(next)} (in ${days} days)`);
    }

    return `\n\n🛠 <b>ሲስተም</b>\n${lines.join("\n")}`;
  } catch (e) {
    console.error("systemDigest failed:", e);
    return `\n\n🛠 <b>ሲስተም</b>\n⚠️ System status could not be read: ${escapeHtml(e instanceof Error ? e.message : String(e))}`;
  }
}
