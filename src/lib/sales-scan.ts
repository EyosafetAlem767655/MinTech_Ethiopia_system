import sql, { first, jsonb } from "@/lib/sql";
import { logError } from "@/lib/errors";
import { loadImages } from "@/lib/images";
import { loadSession, saveSession } from "@/lib/sessions";
import { sendMessage } from "@/lib/telegram";
import { extractSalesReceipt, type SalesReceiptDraft } from "@/lib/receipt-scan";
import { salesReviewText, SALES_REVIEW_KEYBOARD, SALES_MANUAL_KEYBOARD, SALES_BTN } from "@/lib/sales-flow";

/**
 * Reading a sale's paperwork outside the webhook's reply path.
 *
 * A sale arrives as several documents — the main cash-sale receipt, the 3% WHT
 * receipt, sometimes a bank slip — and reading them takes seconds. Doing that
 * before answering Telegram produced "Gemini timed out after 8000ms" on a
 * salesperson's phone, and worse: an update that is not answered in time is
 * redelivered by Telegram forever.
 *
 * So the webhook writes a job, answers immediately, and the read continues after
 * the response via `runAfter`. It does NOT hand the work to another function
 * over HTTP — that was the previous design and it is why the flow went silent:
 * an un-awaited fetch fired just before returning is not guaranteed to leave the
 * instance, and if APP_URL was unset it was never even attempted.
 *
 * The job row survives all of that. Whatever kills the invocation, the work is
 * still queued and the scheduled sweep picks it up.
 */

export interface ScanJob {
  id: string;
  chatId: string;
  reportedBy: string;
  saleDate: string;
  /** Telegram file ids. Nothing is uploaded to storage — see src/lib/images.ts. */
  photoFileIds: string[];
  attempts: number;
}

/** How many times a job is retried before it is given up on. */
export const MAX_SCAN_ATTEMPTS = 3;

/** A job stuck in `reading` this long had its worker killed mid-read. */
const STUCK_MINUTES = 5;

export async function createScanJob(opts: {
  chatId: string;
  reportedBy: string;
  saleDate: string;
  photoFileIds: string[];
}): Promise<string | null> {
  const row = first(
    await sql<{ id: string }[]>`
      insert into sales_scan_jobs (chat_id, reported_by, sale_date, photo_file_ids)
      values (${opts.chatId}, ${opts.reportedBy}, ${opts.saleDate}, ${opts.photoFileIds})
      returning id
    `.catch(async (e) => {
      await logError({
        source: "sales-scan",
        kind: "scan_job_insert_failed",
        message: e instanceof Error ? e.message : String(e),
        chatId: opts.chatId,
      });
      return [];
    })
  );
  return row?.id ?? null;
}

/**
 * Take the next job, atomically.
 *
 * The claim IS the lock. The webhook reads its own job and a cron sweeps stuck
 * ones, so two runs can easily overlap — and reading one sale twice would post
 * two drafts and, if both were approved, file the sale twice.
 * `update … where status = 'pending' … returning` lets exactly one win.
 */
export async function claimNextJob(): Promise<ScanJob | null> {
  const row = first(
    await sql<Record<string, unknown>[]>`
      update sales_scan_jobs
         set status = 'reading', attempts = attempts + 1, claimed_at = now(), updated_at = now()
       where id = (
         select id from sales_scan_jobs
          where status = 'pending'
             -- Jobs whose worker died mid-read. Without this a killed function
             -- leaves the reporter waiting for a reply that will never come.
             or (status = 'reading' and claimed_at < now() - (${STUCK_MINUTES} || ' minutes')::interval)
          order by created_at
          limit 1
          for update skip locked
       )
      returning id, chat_id as "chatId", reported_by as "reportedBy",
                sale_date as "saleDate", photo_file_ids as "photoFileIds", attempts
    `
  );
  if (!row) return null;
  return {
    id: String(row.id),
    chatId: String(row.chatId),
    reportedBy: String(row.reportedBy),
    saleDate: String(row.saleDate),
    photoFileIds: ((row.photoFileIds as string[]) || []).map(String),
    attempts: Number(row.attempts) || 1,
  };
}

/**
 * Read one job's documents into a single draft.
 *
 * Every failure path ends the same way: the job is marked failed with a reason,
 * and the reason is logged. A read that quietly disappears leaves someone
 * holding a phone full of receipts and no idea whether to send them again.
 */
export async function runScanJob(job: ScanJob): Promise<
  { ok: true; draft: SalesReceiptDraft; confidence: number; notes: string } | { ok: false; error: string }
> {
  // Straight from Telegram to the model. Nothing is fetched from storage and
  // nothing was put there.
  const images = await loadImages(job.photoFileIds);

  if (images.length === 0) {
    const error = "the documents could not be fetched back from Telegram";
    await failJob(job, error);
    return { ok: false, error };
  }

  const read = await extractSalesReceipt(images);
  if (!read.ok) {
    // Retryable until the attempt limit — the job goes back to pending so the
    // next drain or the scheduled sweep picks it up.
    const retriable = job.attempts < MAX_SCAN_ATTEMPTS;
    if (retriable) {
      await sql`
        update sales_scan_jobs
           set status = 'pending', error = ${read.error}, updated_at = now()
         where id = ${job.id}
      `.catch(() => {});
    } else {
      await failJob(job, read.error);
    }
    return { ok: false, error: read.error };
  }

  // The date comes from the calendar, not the receipt. The receipts are often
  // photographed a day later, and a read date would silently move the sale.
  const draft: SalesReceiptDraft = { ...read.draft, date: job.saleDate };

  await sql`
    update sales_scan_jobs
       set status = 'done',
           result = ${jsonb({ draft, confidence: read.confidence, notes: read.notes })},
           error = null, updated_at = now()
     where id = ${job.id}
  `.catch(() => {});

  return { ok: true, draft, confidence: read.confidence, notes: read.notes };
}

async function failJob(job: ScanJob, error: string): Promise<void> {
  await sql`
    update sales_scan_jobs set status = 'failed', error = ${error}, updated_at = now()
     where id = ${job.id}
  `.catch(() => {});
  await logError({
    source: "sales-scan",
    kind: "sales_scan_failed",
    message: error,
    detail: { jobId: job.id, attempts: job.attempts, photos: job.photoFileIds.length },
    actor: job.reportedBy,
    chatId: job.chatId,
  });
}

/**
 * Read one claimed job and tell its reporter what happened.
 *
 * The reply is posted from here rather than by the caller so that the webhook's
 * own background read and the scheduled sweep produce identical messages. Two
 * copies of the same card is exactly the sort of thing that drifts.
 */
async function deliverJob(job: ScanJob): Promise<void> {
  const result = await runScanJob(job);

  if (!result.ok) {
    const willRetry = job.attempts < MAX_SCAN_ATTEMPTS;
    if (willRetry) {
      await sendMessage(
        job.chatId,
        `⏳ ደረሰኙን ማንበብ አልተሳካም — በራሱ እንደገና እየሞከረ ነው። (${job.attempts}/${MAX_SCAN_ATTEMPTS})`
      ).catch(() => {});
      return;
    }

    // Out of attempts. The day's sales must still be fileable, so the reporter
    // is handed the manual route rather than a dead end — a broken model key
    // cannot be allowed to mean "no sales report today".
    const session = await loadSession(job.chatId, job.reportedBy).catch(() => null);
    if (session) {
      session.state = "sales_reading";
      await saveSession(session).catch(() => {});
    }
    await sendMessage(
      job.chatId,
      `⚠️ ደረሰኙን ማንበብ አልተቻለም፦ ${result.error}\n\n` +
        `"${SALES_BTN.manual}" ይጫኑ — መስኮቹን በጥያቄ እንሞላቸዋለን። ወይም ግልጽ ፎቶ ድጋሚ ይላኩ።`,
      { reply_markup: SALES_MANUAL_KEYBOARD }
    ).catch(() => {});
    return;
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
}

/**
 * Claim and read up to `max` jobs, in order.
 *
 * A loop rather than one-job-then-trigger-another-invocation. The chained
 * version depended on an un-awaited self-fetch landing, which is precisely what
 * failed in production: one dropped call and every job behind it waited for the
 * next day's cron.
 */
export async function drainScanJobs(max = 5): Promise<{ read: number }> {
  let read = 0;
  for (let i = 0; i < max; i++) {
    const job = await claimNextJob().catch(async (e) => {
      await logError({
        source: "sales-scan",
        kind: "scan_claim_failed",
        message: e instanceof Error ? e.message : String(e),
      });
      return null;
    });
    if (!job) break;

    try {
      await deliverJob(job);
    } catch (e) {
      // The job stays claimed and the 5-minute reclaim window brings it back.
      // Logging it is the point: this used to vanish into a `.catch(() => {})`.
      await logError({
        source: "sales-scan",
        kind: "scan_delivery_failed",
        message: e instanceof Error ? e.message : String(e),
        detail: { jobId: job.id, attempts: job.attempts },
        actor: job.reportedBy,
        chatId: job.chatId,
      });
    }
    read += 1;
  }
  return { read };
}
