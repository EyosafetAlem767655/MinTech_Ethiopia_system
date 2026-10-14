import { NextRequest, NextResponse } from "next/server";
import { HEALTH_KEYS, HEALTH_LABEL, isHealthKey, runAllHealthChecks, runHealthCheck } from "@/lib/api-health";
import { latestJobRuns } from "@/lib/system-jobs";

export const dynamic = "force-dynamic";
// A busy provider is asked twice (see api-health.ts), each bounded.
export const maxDuration = 120;

/**
 * The API checks behind Settings → Errors. Behind the dashboard password like
 * every /api path (middleware.ts).
 *
 * GET  — the list of checks and the last automated run (the daily "api-health"
 *        job), so the card shows something before anyone presses a button.
 * POST — run checks now: `{ key }` for one, nothing for all of them.
 */
export async function GET() {
  const last = (await latestJobRuns()).get("api-health");
  return NextResponse.json({
    checks: HEALTH_KEYS.map((key) => ({ key, label: HEALTH_LABEL[key] })),
    lastRun: last
      ? { at: last.startedAt, ok: last.ok, summary: last.summary, results: last.detail?.results ?? [] }
      : null,
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { key?: string };
  if (body.key !== undefined) {
    if (!isHealthKey(body.key)) return NextResponse.json({ error: `Unknown check "${body.key}".` }, { status: 400 });
    return NextResponse.json({ results: [await runHealthCheck(body.key)] });
  }
  return NextResponse.json({ results: await runAllHealthChecks() });
}
