import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { PHOTO_KEEP_DAYS, purgeProcessedPhotos, undecidedPhotos } from "@/lib/storage";
import { runJob } from "@/lib/system-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily photo clean-up: an uploaded photo goes three months after the thing it
 * evidences was decided (see PHOTO_KEEP_DAYS in src/lib/storage.ts). The report,
 * its figures and its AI verdict stay; only the image is reclaimed. A photo
 * whose subject is still undecided is kept, and counted, so the morning summary
 * can say how many decisions are sitting open.
 *
 * Bot photos are Telegram file ids and never reach this bucket, so there is
 * nothing here to delete for them.
 *
 * `?days=N` overrides the keep period for a manual run.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const daysRaw = req.nextUrl.searchParams.get("days");
  const days = daysRaw === null ? PHOTO_KEEP_DAYS : Math.max(0, Number(daysRaw) || 0);

  try {
    const result = await runJob("purge-photos", async () => {
      // Drain in batches so a backlog cannot blow the function's time budget;
      // whatever is left is picked up tomorrow.
      let deleted = 0;
      for (let i = 0; i < 20; i++) {
        const res = await purgeProcessedPhotos(days);
        deleted += res.deleted;
        if (res.deleted === 0) break;
      }

      const undecided = await undecidedPhotos(days);
      const waiting = undecided.reduce((a, u) => a + u.count, 0);

      // Telegram de-duplication rows only matter for as long as Telegram will
      // retry an update (minutes). Anything older is dead weight.
      const dedupe = await sql<{ count: string }[]>`
        with gone as (
          delete from telegram_updates where created_at < now() - interval '1 day' returning 1
        )
        select count(*)::text as count from gone`.catch((e) => {
        console.error("purge telegram_updates failed:", e);
        return [{ count: "0" }];
      });

      return {
        summary:
          `${deleted} photo${deleted === 1 ? "" : "s"} deleted (decided over ${days} days ago)` +
          (waiting ? `; ${waiting} kept because still undecided` : ""),
        detail: { deleted, days, undecided, dedupeRowsDeleted: Number(dedupe[0]?.count || 0) },
      };
    });
    return NextResponse.json({ ok: true, ...result.detail, summary: result.summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
