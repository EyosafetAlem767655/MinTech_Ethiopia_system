import { NextRequest, NextResponse } from "next/server";
import {
  archiveRecipients,
  buildArchive,
  purgeOlderThan,
  RETENTION_DAYS,
  type ArchiveMode,
} from "@/lib/archive";
import { sendDocument, sendMessage } from "@/lib/telegram";
import { logActivity } from "@/lib/bot-auth";

export const dynamic = "force-dynamic";
// Exporting every table into one workbook is the longest-running job in the
// system, and it runs once a year. A timeout here is not a lost minute — it is a
// year's data left unarchived, so it gets the longest budget available.
export const maxDuration = 300;

/**
 * The yearly reset: export the whole database to one workbook, Telegram it to
 * the administrators, then empty it and start the new year clean.
 *
 * The ordering is the entire safety property. The workbook becomes the only
 * surviving copy of these records, so NOTHING is deleted unless at least one
 * administrator has confirmably received the file. Every early return below is
 * a refusal to delete.
 *
 * Employees, their logins and the registered push devices are never touched —
 * wiping those would lock everyone out of the bot on the 1st of September.
 *
 *   ?mode=retention  archive only what is older than a year, the rolling window
 *                    this job originally implemented. The scheduled run is
 *                    `full`.
 *   ?dryRun=1        builds and sends the archive but skips the delete — use
 *                    this to check the file is complete before trusting a run.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  const mode: ArchiveMode = req.nextUrl.searchParams.get("mode") === "retention" ? "retention" : "full";

  try {
    const archive = await buildArchive(new Date(), mode);

    if (archive.totalRows === 0 || !archive.workbook) {
      return NextResponse.json({
        ok: true,
        purged: false,
        reason: mode === "full" ? "the database is already empty" : "nothing older than the retention window",
        cutoff: archive.cutoff,
        retentionDays: RETENTION_DAYS,
      });
    }

    // Work out who can receive it. An admin without a chat_id has never signed
    // into the bot and cannot be sent anything.
    const admins = await archiveRecipients();
    const ceo = (process.env.TELEGRAM_CEO_CHAT_ID || "").trim();
    const targets = admins.length > 0
      ? admins.map((a) => ({ chatId: a.chatId, label: a.fullName }))
      : ceo
        ? [{ chatId: ceo, label: "owner (fallback — no admin is signed in)" }]
        : [];

    if (targets.length === 0) {
      // Refuse. Deleting with nowhere to send the archive destroys the data.
      await logActivity({
        chatId: "system",
        actor: "retention job",
        action: "error",
        ok: false,
        detail: "archive not sent: no admin has signed into the bot and TELEGRAM_CEO_CHAT_ID is unset — nothing deleted",
      });
      return NextResponse.json(
        {
          ok: false,
          purged: false,
          error:
            "No archive recipient. Give someone the 'admin' position at /settings and have them sign into the bot, " +
            "or set TELEGRAM_CEO_CHAT_ID. Nothing was deleted.",
          rowsPending: archive.totalRows,
        },
        { status: 412 }
      );
    }

    const scope =
      archive.cutoff === null
        ? `Every record in the database, up to ${new Date().toISOString().slice(0, 10)}.`
        : `Records older than ${RETENTION_DAYS} days (before ${archive.cutoff.toISOString().slice(0, 10)}).`;

    const caption =
      (mode === "full" ? `🗄️ <b>MinTech yearly archive</b>\n` : `🗄️ <b>MinTech data archive</b>\n`) +
      `${scope}\n` +
      `<b>${archive.totalRows}</b> rows across ${Object.values(archive.counts).filter(Boolean).length} tables.\n\n` +
      (dryRun
        ? `<i>Dry run — nothing has been deleted.</i>`
        : `⚠️ <b>This is the only copy. These records are now deleted from the database.</b>` +
          (mode === "full" ? `\n<i>Employees and logins are unaffected — the bot keeps working.</i>` : ""));

    const delivered: string[] = [];
    const failed: { label: string; error: string }[] = [];
    for (const t of targets) {
      const res = await sendDocument(
        t.chatId,
        { buffer: archive.workbook, filename: archive.filename, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
        caption
      );
      if (res?.ok) delivered.push(t.label);
      else failed.push({ label: t.label, error: res?.description || "unknown" });
    }

    if (delivered.length === 0) {
      // Telegram rejected every attempt — keep the data.
      await logActivity({
        chatId: "system",
        actor: "retention job",
        action: "error",
        ok: false,
        detail: `archive delivery failed for all ${targets.length} recipient(s) — nothing deleted`,
        meta: { failed },
      });
      return NextResponse.json(
        { ok: false, purged: false, error: "Archive could not be delivered; nothing was deleted.", failed },
        { status: 502 }
      );
    }

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        purged: false,
        cutoff: archive.cutoff,
        totalRows: archive.totalRows,
        counts: archive.counts,
        delivered,
        failed,
      });
    }

    const deleted = await purgeOlderThan(archive.cutoff);
    const deletedTotal = Object.values(deleted).reduce((a, b) => a + b, 0);

    await logActivity({
      chatId: "system",
      actor: "retention job",
      action: "submission",
      detail: `archived ${archive.totalRows} rows to ${delivered.join(", ")} and purged ${deletedTotal}`,
      meta: { cutoff: archive.cutoff, counts: archive.counts, deleted },
    });

    for (const t of targets.filter((x) => delivered.includes(x.label))) {
      await sendMessage(
        t.chatId,
        `✅ ማህደሩ ተልኳል፤ <b>${deletedTotal}</b> የቆዩ መዝገቦች ከዴታቤዙ ተሰርዘዋል።\n<i>Archive delivered; ${deletedTotal} expired records deleted.</i>`
      ).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      purged: true,
      cutoff: archive.cutoff,
      archivedRows: archive.totalRows,
      deletedRows: deletedTotal,
      counts: archive.counts,
      deleted,
      delivered,
      failed,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("archive-and-purge failed:", e);
    await logActivity({
      chatId: "system",
      actor: "retention job",
      action: "error",
      ok: false,
      detail: `archive-and-purge threw: ${message.slice(0, 300)} — nothing deleted`,
    }).catch(() => {});
    return NextResponse.json({ ok: false, purged: false, error: message }, { status: 500 });
  }
}
