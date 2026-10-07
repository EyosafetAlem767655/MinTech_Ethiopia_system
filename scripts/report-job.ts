/**
 * Record a GitHub Actions job in `system_jobs`, and tell the administrators if
 * it failed.
 *
 *   npx tsx scripts/report-job.ts <job> <ok|fail> "<summary>" ['<detail json>']
 *
 * The nightly backup runs in GitHub, not in the app, so on its own it leaves no
 * trace the app can see — a backup that stopped working would look the same as
 * one that worked. This closes that gap: the workflow's last step calls this
 * whatever happened, and the System Admin view reads the row.
 *
 * Env: SUPABASE_DB_URL (the workflow passes the session-pooler string) and
 * TELEGRAM_BOT_TOKEN for the failure message.
 */
import sql from "../src/lib/sql";
import { recordJob } from "../src/lib/system-jobs";

async function main() {
  const [job, status, summary, detailJson] = process.argv.slice(2);
  if (!job || !["ok", "fail"].includes(status ?? "")) {
    console.error('Usage: report-job.ts <job> <ok|fail> "<summary>" [\'<detail json>\']');
    process.exit(2);
  }
  let detail: Record<string, unknown> | undefined;
  if (detailJson) {
    try {
      detail = JSON.parse(detailJson);
    } catch {
      detail = { raw: detailJson };
    }
  }
  await recordJob({
    job,
    startedAt: new Date(Number(process.env.JOB_STARTED_AT) * 1000 || Date.now()),
    ok: status === "ok",
    summary: summary || (status === "ok" ? "ok" : "failed"),
    detail,
    source: "github",
  });
  console.log(`recorded ${job}: ${status} — ${summary}`);
}

main()
  .catch((e) => {
    // Reporting must never be the thing that fails the workflow: the job's own
    // result is what the run shows. Say so and move on.
    console.error("report-job could not record the run:", e);
  })
  .finally(() => sql.end({ timeout: 5 }).catch(() => {}));
