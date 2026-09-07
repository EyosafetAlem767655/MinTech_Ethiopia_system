import { NextRequest, NextResponse } from "next/server";
import { drainScanJobs } from "@/lib/sales-scan";

export const dynamic = "force-dynamic";
// The whole reason this route exists is to be somewhere a slow read is allowed
// to be slow. Nothing is waiting on it.
export const maxDuration = 300;

/**
 * The safety net for sales document reads.
 *
 * The usual path no longer comes through here at all: the webhook answers
 * Telegram and then finishes the read in its own invocation, so nothing depends
 * on one function successfully calling another over HTTP. That dependency is
 * what broke — an un-awaited self-fetch fired just before returning does not
 * reliably leave the instance, and the flow went silent with no error anywhere.
 *
 * This runs every five minutes and drains whatever is left: a job whose
 * invocation was killed mid-read, or one whose read failed and went back to
 * pending. `claimNextJob` takes each atomically, so a sweep overlapping the
 * webhook's own read never reads the same sale twice — which would post two
 * drafts and, if both were approved, file the sale twice.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { read } = await drainScanJobs(5);
  return NextResponse.json({ ok: true, read });
}

/** GET is the cron's entry point; it does exactly the same work. */
export async function GET(req: NextRequest) {
  return POST(req);
}
