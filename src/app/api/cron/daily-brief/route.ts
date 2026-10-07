import { NextRequest, NextResponse } from "next/server";
import { assembleAndSendBrief } from "@/lib/brief";
import { runJob } from "@/lib/system-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Runs at dawn Ethiopia time (03:30 UTC = 06:30 EAT): assembles the brief, asks
 * the LLM for the narrative, and sends Telegram + push. Lot balances are now
 * derived by a view, so there is no reconciliation step.
 *
 * This route used to start the retention job on the 1st of every month. That
 * job had since become a FULL reset — export everything, then empty the
 * database — so the ride-along would have wiped the system monthly. Retention
 * now belongs to the quarterly Neon archive (scripts/archive-to-neon.ts), which
 * copies and verifies before it removes anything, and this route only briefs.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runJob("daily-brief", async () => {
    const r = await assembleAndSendBrief();
    return {
      summary: `brief for ${r.date}: ${r.exceptions?.length ?? 0} exception(s), Telegram ${r.sentTelegram ? "sent" : "NOT sent"}`,
      // A brief that was assembled but never reached the owner did not do its job.
      ok: Boolean(r.sentTelegram),
      detail: { date: r.date, exceptions: r.exceptions?.length ?? 0, sentTelegram: r.sentTelegram, briefId: r.briefId },
      result: r,
    };
  });
  return NextResponse.json({ ok: true, ...result.result });
}
