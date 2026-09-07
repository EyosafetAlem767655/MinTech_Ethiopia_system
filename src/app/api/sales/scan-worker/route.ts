import { NextRequest, NextResponse } from "next/server";
import { loadSession, saveSession } from "@/lib/sessions";
import { sendMessage } from "@/lib/telegram";
import { claimNextJob, runScanJob, triggerScanWorker, MAX_SCAN_ATTEMPTS } from "@/lib/sales-scan";
import { salesReviewText, SALES_REVIEW_KEYBOARD } from "@/lib/sales-flow";

export const dynamic = "force-dynamic";
// The whole reason this route exists is to be somewhere a slow read is allowed
// to be slow. Nothing is waiting on it.
export const maxDuration = 300;

/**
 * Reads one sale's documents and posts the result back to its chat.
 *
 * Triggered two ways, on purpose:
 *   • the webhook fires it (un-awaited) the moment the photos are in, so the
 *     usual case is fast;
 *   • the daily cron sweeps anything left behind, so a lost trigger or a killed
 *     function costs a delay rather than the batch.
 *
 * Both can arrive together. `claimNextJob` takes the job atomically, so the same
 * sale is never read twice — which would post two drafts and, if both were
 * approved, file the sale twice.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const job = await claimNextJob();
  if (!job) return NextResponse.json({ ok: true, claimed: false });

  const result = await runScanJob(job);

  if (!result.ok) {
    const willRetry = job.attempts < MAX_SCAN_ATTEMPTS;
    await sendMessage(
      job.chatId,
      willRetry
        ? `⏳ ደረሰኙን ማንበብ አልተሳካም — በራሱ እንደገና እየሞከረ ነው። (${job.attempts}/${MAX_SCAN_ATTEMPTS})`
        : `⚠️ ደረሰኙን ማንበብ አልተቻለም፦ ${result.error}\n\n` +
            `ፎቶዎቹ ተቀምጠዋል። ግልጽ ፎቶ ድጋሚ መላክ ወይም በእጅ ማስገባት ይችላሉ።`
    ).catch(() => {});
    // Another job may be waiting behind this one.
    triggerScanWorker();
    return NextResponse.json({ ok: true, claimed: true, read: false, willRetry });
  }

  // Hand the draft to the flow the reporter is already sitting in.
  const session = await loadSession(job.chatId, job.reportedBy);
  session.state = "receipt_action";
  session.receiptScan = {
    ...(session.receiptScan || {}),
    mode: "scan",
    saleDate: job.saleDate,
    images: job.photoFileIds,
    draft: result.draft,
    confidence: result.confidence,
    jobId: job.id,
  };
  await saveSession(session);

  await sendMessage(job.chatId, salesReviewText(result.draft, result.confidence, result.notes), {
    reply_markup: SALES_REVIEW_KEYBOARD,
  }).catch(() => {});

  triggerScanWorker();
  return NextResponse.json({ ok: true, claimed: true, read: true });
}

/** GET is the cron's entry point; it does exactly the same work. */
export async function GET(req: NextRequest) {
  return POST(req);
}
