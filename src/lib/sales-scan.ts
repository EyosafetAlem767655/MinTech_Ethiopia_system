import sql, { first, jsonb } from "@/lib/sql";
import { logError } from "@/lib/errors";
import { getFileBytes } from "@/lib/storage";
import { extractSalesReceipt, type SalesReceiptDraft } from "@/lib/receipt-scan";

/**
 * Reading a sale's paperwork outside the webhook's reply path.
 *
 * A sale arrives as several documents — the main cash-sale receipt, the 3% WHT
 * receipt, sometimes a bank slip — and reading them takes seconds. Doing that
 * before answering Telegram is what produced "Gemini timed out after 8000ms" on
 * a salesperson's phone, and worse: an update that is not answered in time is
 * redelivered by Telegram forever.
 *
 * So the webhook writes a job, answers immediately, and a worker reads it.
 */

export interface ScanJob {
  id: string;
  chatId: string;
  reportedBy: string;
  saleDate: string;
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
 * The claim IS the lock. The webhook triggers the worker and a cron sweeps stuck
 * jobs, so two invocations can easily arrive together — and reading one sale
 * twice would post two drafts and, if both were approved, file the sale twice.
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
  const images: { base64: string; contentType: string }[] = [];
  for (const id of job.photoFileIds) {
    const f = await getFileBytes(id).catch(() => null);
    if (f) images.push({ base64: f.base64, contentType: f.contentType });
  }

  if (images.length === 0) {
    const error = "the photos could not be loaded back from storage";
    await failJob(job, error);
    return { ok: false, error };
  }

  const read = await extractSalesReceipt(images);
  if (!read.ok) {
    // Retryable until the attempt limit — the worker leaves it pending so the
    // next trigger or the cron sweep picks it up.
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
 * Ask the worker to run, without waiting for it.
 *
 * Deliberately not awaited by the caller and deliberately swallowing every
 * error: this is called from the webhook, and the whole point is that the reply
 * does not depend on it. If the trigger is lost, the cron sweep still gets the
 * job — the trigger is an optimisation, not the delivery mechanism.
 */
export function triggerScanWorker(): void {
  const base = process.env.APP_URL;
  if (!base) return;
  const secret = process.env.CRON_SECRET;
  void fetch(`${base.replace(/\/$/, "")}/api/sales/scan-worker`, {
    method: "POST",
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  }).catch(() => {});
}
