import { NextRequest, NextResponse } from "next/server";
import { archiveRecipients, buildArchive, RETENTION_DAYS, type ArchiveMode } from "@/lib/archive";
import { sendDocument } from "@/lib/telegram";
import { logActivity } from "@/lib/bot-auth";
import { recordJob } from "@/lib/system-jobs";

export const dynamic = "force-dynamic";
// Exporting every table into one workbook is the longest-running request in
// the system, so it keeps the longest budget available.
export const maxDuration = 300;

/**
 * Export the database to one workbook and Telegram it to the administrators.
 * EXPORT ONLY — this route deletes nothing, whatever it is asked.
 *
 * It used to be the yearly reset: export, then empty the database. That reset
 * was triggered on 1 September by vercel.json and, by a leftover in the
 * daily-brief route, on the 1st of EVERY month, so the system was one delivered
 * spreadsheet away from being wiped monthly. Both triggers are gone, and
 * removing records is now the quarterly Neon archive's job
 * (scripts/archive-to-neon.ts), which copies to a second database and verifies
 * the copy before it removes anything from this one.
 *
 * What remains is useful on its own: a spreadsheet of the data, on demand.
 *
 *   ?mode=retention  only records older than RETENTION_DAYS
 *   (default)        every record
 *
 * The route name is kept so existing bookmarks and runbooks still resolve.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const mode: ArchiveMode = req.nextUrl.searchParams.get("mode") === "retention" ? "retention" : "full";
  const startedAt = new Date();

  try {
    const archive = await buildArchive(new Date(), mode);
    if (archive.totalRows === 0 || !archive.workbook) {
      return NextResponse.json({ ok: true, sent: false, reason: "nothing to export", cutoff: archive.cutoff });
    }

    const admins = await archiveRecipients();
    const ceo = (process.env.TELEGRAM_CEO_CHAT_ID || "").trim();
    const targets =
      admins.length > 0
        ? admins.map((a) => ({ chatId: a.chatId, label: a.fullName }))
        : ceo
          ? [{ chatId: ceo, label: "owner (fallback — no admin is signed in)" }]
          : [];
    if (targets.length === 0) {
      return NextResponse.json(
        { ok: false, sent: false, error: "No recipient: give someone the 'admin' position and have them sign into the bot." },
        { status: 412 }
      );
    }

    const scope =
      archive.cutoff === null
        ? `Every record, up to ${new Date().toISOString().slice(0, 10)}.`
        : `Records older than ${RETENTION_DAYS} days (before ${archive.cutoff.toISOString().slice(0, 10)}).`;
    const caption =
      `🗄️ <b>MinTech data export</b>\n${scope}\n` +
      `<b>${archive.totalRows}</b> rows across ${Object.values(archive.counts).filter(Boolean).length} tables.\n\n` +
      `<i>A copy only — nothing has been deleted.</i>`;

    const delivered: string[] = [];
    const failed: { label: string; error: string }[] = [];
    for (const t of targets) {
      const res = await sendDocument(
        t.chatId,
        {
          buffer: archive.workbook,
          filename: archive.filename,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        caption
      );
      if (res?.ok) delivered.push(t.label);
      else failed.push({ label: t.label, error: res?.description || "unknown" });
    }

    await logActivity({
      chatId: "system",
      actor: "data export",
      action: delivered.length > 0 ? "submission" : "error",
      ok: delivered.length > 0,
      detail: `exported ${archive.totalRows} rows to ${delivered.join(", ") || "nobody"} — nothing deleted`,
      meta: { counts: archive.counts, failed },
    });

    await recordJob({
      job: "data-export",
      startedAt,
      ok: delivered.length > 0,
      summary: `${archive.totalRows} rows exported to ${delivered.join(", ") || "nobody"}`,
      detail: { counts: archive.counts, failed },
    });

    return NextResponse.json({
      ok: delivered.length > 0,
      sent: delivered.length > 0,
      totalRows: archive.totalRows,
      counts: archive.counts,
      delivered,
      failed,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("data export failed:", e);
    await recordJob({ job: "data-export", startedAt, ok: false, summary: `threw: ${message}` });
    return NextResponse.json({ ok: false, sent: false, error: message }, { status: 500 });
  }
}
