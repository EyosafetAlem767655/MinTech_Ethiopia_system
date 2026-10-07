import sql, { jsonb } from "@/lib/sql";
import { notifyAdmins } from "@/lib/admins";
import { escapeHtml } from "@/lib/errors";

/**
 * Every scheduled job leaves a row in `system_jobs` (migration 0036).
 *
 * Before this, a job's only trace was its HTTP response, which nothing kept —
 * so a job that quietly stopped running looked identical to one that worked.
 * Now each run is recorded, a failure reaches the administrators the moment it
 * happens, and the status view treats a job with no recent row as MISSING
 * rather than fine.
 *
 * Recording never breaks the job it records. If the table is not there yet (the
 * migration not run) or the database blinks, the job still runs and still
 * returns; only the row is lost, and that is said in the platform log.
 */

export interface JobOutcome {
  /** False marks a run that finished but did not do its job. Default true. */
  ok?: boolean;
  /** One line a person can read in Telegram. */
  summary: string;
  detail?: Record<string, unknown>;
}

/**
 * The jobs this system runs, what to call them, and how often a healthy one
 * leaves a row. `everyHours` is what the status view checks a job against: a
 * daily job with no row in 26 hours is reported as not having run.
 */
export const JOBS: Record<string, { label: string; everyHours: number | null; source: "vercel" | "github" }> = {
  backup: { label: "Nightly backup → Neon", everyHours: 26, source: "github" },
  "daily-brief": { label: "Morning brief", everyHours: 26, source: "vercel" },
  "morning-reminder": { label: "Reminders & digests", everyHours: 26, source: "vercel" },
  "purge-photos": { label: "Photo clean-up (3 months)", everyHours: 26, source: "vercel" },
  "finance-daily": { label: "Finance chase", everyHours: 26, source: "vercel" },
  archive: { label: "Quarterly move → Neon archive", everyHours: null, source: "github" },
  "data-export": { label: "Spreadsheet export (on demand)", everyHours: null, source: "vercel" },
};

export interface JobRow {
  job: string;
  startedAt: Date;
  finishedAt: Date | null;
  ok: boolean | null;
  summary: string | null;
  detail: Record<string, unknown> | null;
  source: string;
}

/** Write one finished run. Never throws. */
export async function recordJob(row: {
  job: string;
  startedAt: Date;
  ok: boolean;
  summary: string;
  detail?: Record<string, unknown>;
  source?: string;
}): Promise<void> {
  try {
    await sql`
      insert into system_jobs (job, started_at, finished_at, ok, summary, detail, source)
      values (${row.job}, ${row.startedAt}, now(), ${row.ok}, ${row.summary.slice(0, 1000)},
              ${row.detail ? jsonb(row.detail) : null}, ${row.source ?? "vercel"})
    `;
  } catch (e) {
    console.error(`recordJob(${row.job}) could not write its row:`, e);
  }
  if (!row.ok) {
    await notifyAdmins(
      `❌ <b>${escapeHtml(JOBS[row.job]?.label ?? row.job)} አልተሳካም</b>\n` +
        `${escapeHtml(row.summary.slice(0, 400))}\n\n` +
        `<i>Job failed. Details: 🛠 System Admin → 🔁 Jobs.</i>`
    );
  }
}

/**
 * Run a job and record it. A throw is recorded as a failure, the
 * administrators are told, and the error is rethrown so the route still
 * answers 500 as it did before.
 */
export async function runJob<T extends JobOutcome>(job: string, work: () => Promise<T>): Promise<T> {
  const startedAt = new Date();
  try {
    const out = await work();
    await recordJob({ job, startedAt, ok: out.ok !== false, summary: out.summary, detail: out.detail });
    return out;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordJob({ job, startedAt, ok: false, summary: `threw: ${message}` });
    throw e;
  }
}

/** The newest row for each job. Empty when the table does not exist yet. */
export async function latestJobRuns(): Promise<Map<string, JobRow>> {
  const out = new Map<string, JobRow>();
  try {
    const rows = await sql<Record<string, unknown>[]>`
      select distinct on (job) job, started_at, finished_at, ok, summary, detail, source
        from system_jobs
       order by job, started_at desc
    `;
    for (const r of rows) {
      out.set(String(r.job), {
        job: String(r.job),
        startedAt: new Date(String(r.started_at)),
        finishedAt: r.finished_at ? new Date(String(r.finished_at)) : null,
        ok: r.ok === null ? null : Boolean(r.ok),
        summary: (r.summary as string) ?? null,
        detail: (r.detail as Record<string, unknown>) ?? null,
        source: String(r.source),
      });
    }
  } catch (e) {
    if ((e as { code?: string })?.code !== "42P01") console.error("latestJobRuns failed:", e);
  }
  return out;
}

/**
 * Is this job overdue? A job with a cadence and no row inside it has not run,
 * whatever its last result said — the case the old setup could not see at all.
 */
export function isOverdue(job: string, last: JobRow | undefined, now = new Date()): boolean {
  const every = JOBS[job]?.everyHours;
  if (!every) return false;
  if (!last) return true;
  return now.getTime() - last.startedAt.getTime() > every * 3600_000;
}
