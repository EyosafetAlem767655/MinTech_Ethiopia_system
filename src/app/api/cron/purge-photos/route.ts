import { NextRequest, NextResponse } from "next/server";
import { purgeOldPhotos } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Retention for uploaded images: delete the raw photos from the bucket once they
 * are older than 72 hours. The extracted data (sales reports, daily reports, …)
 * stays — only the heavy binary is reclaimed. Runs on a schedule (vercel.json)
 * and can be triggered manually with ?hours=N.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const hours = Math.max(1, Number(req.nextUrl.searchParams.get("hours")) || 72);

  // Drain in batches so a large backlog can't blow the function time budget;
  // whatever isn't cleared this run is picked up on the next schedule.
  let deleted = 0;
  for (let i = 0; i < 20; i++) {
    const res = await purgeOldPhotos(hours);
    deleted += res.deleted;
    if (res.deleted === 0) break;
  }

  return NextResponse.json({ ok: true, deleted, olderThanHours: hours });
}
