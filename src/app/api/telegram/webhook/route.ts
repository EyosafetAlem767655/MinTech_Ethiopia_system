import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import {
  BagLot,
  DamageClaim,
  PurchaseRequest,
  Receipt,
  ShiftReport,
  StoneDelivery,
  StoredFile,
  TelegramSession,
  Brief,
} from "@/lib/models";
import { classifyIngestion, type IngestionExtraction } from "@/lib/llm";
import { downloadTelegramFile, sendMessage } from "@/lib/telegram";
import { processClaimPhoto } from "@/lib/claims";
import { companyChat } from "@/lib/chat";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* ───────────────────────────── Record creation ────────────────────────────── */

async function saveExtractedRecord(
  extraction: IngestionExtraction,
  opts: { fileId?: string; userName: string }
): Promise<string> {
  const f = extraction.fields as Record<string, any>;
  switch (extraction.docType) {
    case "receipt": {
      await Receipt.create({
        vendor: String(f.vendor || "Unknown vendor"),
        amount: Number(f.amount) || 0,
        category: f.category ? String(f.category) : undefined,
        receiptDate: f.receiptDate ? new Date(String(f.receiptDate)) : undefined,
        photoFileId: opts.fileId || undefined,
        submittedBy: opts.userName,
        source: "telegram",
        meta: f,
      });
      return `🧾 Receipt saved: <b>${f.vendor}</b> — ETB ${Number(f.amount).toLocaleString()}. Thank you!`;
    }
    case "purchase_request": {
      await PurchaseRequest.create({
        title: String(f.title || "Purchase request"),
        amount: Number(f.amount) || 0,
        requestedBy: opts.userName,
        justification: f.justification ? String(f.justification) : undefined,
        photoFileId: opts.fileId || undefined,
        source: "telegram",
        status: "pending",
      });
      return `📝 Purchase request submitted: <b>${f.title}</b> — ETB ${Number(f.amount).toLocaleString()}. It is now waiting for Mr. Anteneh's approval on the dashboard.`;
    }
    case "damage_claim": {
      const lot = await BagLot.findOne({
        lotCode: { $regex: `^${String(f.lotCode || "").trim()}$`, $options: "i" },
      });
      if (!lot) {
        const lots = await BagLot.find().select("lotCode").sort({ receivedAt: -1 }).limit(5).lean();
        return `⚠️ I couldn't find lot "<b>${f.lotCode}</b>". Recent lots: ${lots.map((l) => l.lotCode).join(", ")}. Please resend with the correct lot code.`;
      }
      const photos = [];
      const flags = new Set<string>(["telegram_needs_cosign"]);
      if (opts.fileId) {
        const file = await StoredFile.findById(opts.fileId);
        if (file) {
          const processed = await processClaimPhoto(
            Buffer.from(file.data as unknown as Uint8Array),
            file.contentType,
            lot.bagType
          );
          photos.push(processed.photo);
          processed.flags.forEach((x) => flags.add(x));
        }
      }
      await DamageClaim.create({
        lotId: lot._id,
        quantity: Number(f.quantity) || 1,
        source: "telegram",
        worker: opts.userName,
        photos,
        flags: Array.from(flags),
        status: "cosign_required",
        capturedAt: new Date(),
      });
      return (
        `🛡 Damage claim recorded for lot <b>${lot.lotCode}</b> (${f.quantity} bags). ` +
        `Because it came through Telegram it is <b>flagged for supervisor co-signing</b> before it can be verified.`
      );
    }
    case "stone_delivery": {
      await StoneDelivery.create({
        truckPlate: String(f.truckPlate || "UNKNOWN"),
        loads: Number(f.loads) || 1,
        qualityGrade: ["good", "fair", "dark/weathered"].includes(f.qualityGrade) ? f.qualityGrade : "good",
        notes: f.notes ? String(f.notes) : undefined,
        date: new Date(),
      });
      return `🪨 Stone delivery logged: truck <b>${f.truckPlate}</b>, ${f.loads || 1} load(s), grade: ${f.qualityGrade || "good"}.`;
    }
    case "shift_report": {
      await ShiftReport.create({
        supervisor: opts.userName,
        filledSacks: Number(f.filledSacks) || 0,
        downtimeMinutes: Number(f.downtimeMinutes) || 0,
        shift: f.shift === "night" ? "night" : "day",
        notes: f.notes ? String(f.notes) : undefined,
        date: new Date(),
      });
      return `🏭 Shift report saved: ${f.filledSacks} sacks filled, ${f.downtimeMinutes || 0} min downtime. Thank you!`;
    }
    default:
      return "✅ Noted and stored. If this was a receipt or a request, please tell me the type and amount so I can file it properly.";
  }
}

/* ──────────────────────────────── Webhook ─────────────────────────────────── */

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const provided =
    req.nextUrl.searchParams.get("secret") || req.headers.get("x-telegram-bot-api-secret-token");
  if (secret && provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const update = await req.json().catch(() => null);
  const msg = update?.message;
  if (!msg?.chat?.id) return NextResponse.json({ ok: true });

  await dbConnect();
  const chatId = String(msg.chat.id);
  const userName =
    [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") ||
    msg.from?.username ||
    "Telegram user";
  const text: string = msg.text || msg.caption || "";

  try {
    /* Commands */
    if (text.startsWith("/start")) {
      await sendMessage(
        chatId,
        `👋 Welcome to the <b>MinTech Ethiopia</b> bot, ${userName}!\n\n` +
          `You can send me:\n` +
          `🧾 Photos of receipts\n📝 Purchase requests\n🛡 Damaged bag reports (photo + lot code)\n` +
          `🪨 Truck delivery info\n🏭 End-of-shift numbers\n\n` +
          `I'll ask a question or two and file everything in the right place.\n` +
          `You can also just ask me anything about the company data — e.g. "how much did we collect this week?"`
      );
      return NextResponse.json({ ok: true });
    }
    if (text.startsWith("/brief")) {
      const brief = await Brief.findOne().sort({ date: -1 }).lean();
      if (!brief) {
        await sendMessage(chatId, "No brief has been generated yet. The first one arrives at 6:30 AM.");
      } else {
        const ex =
          brief.exceptions.length > 0
            ? `🚨 <b>Exceptions</b>\n${brief.exceptions.map((e: string) => `• ${e}`).join("\n")}\n\n`
            : "✅ No exceptions.\n\n";
        await sendMessage(
          chatId,
          `☀️ <b>Morning Brief — ${brief.date}</b>\n\n${ex}${brief.fiveLines.join("\n")}\n\n<i>${brief.narrative}</i>`
        );
      }
      return NextResponse.json({ ok: true });
    }
    if (text.startsWith("/cancel")) {
      await TelegramSession.findOneAndUpdate({ chatId }, { state: "idle", draft: null, history: [] });
      await sendMessage(chatId, "Okay, cancelled. Send me something new whenever you're ready.");
      return NextResponse.json({ ok: true });
    }

    const session =
      (await TelegramSession.findOne({ chatId })) ||
      (await TelegramSession.create({ chatId, userName, state: "idle", history: [] }));

    /* Photo / image document → classify with the LLM */
    const photoSizes = msg.photo as { file_id: string }[] | undefined;
    const docIsImage = msg.document?.mime_type?.startsWith("image/");
    if (photoSizes?.length || docIsImage) {
      const tgFileId = docIsImage ? msg.document.file_id : photoSizes![photoSizes!.length - 1].file_id;
      const downloaded = await downloadTelegramFile(tgFileId);
      if (!downloaded) {
        await sendMessage(chatId, "Sorry, I couldn't download that file. Please try again.");
        return NextResponse.json({ ok: true });
      }
      const contentType = docIsImage ? msg.document.mime_type : "image/jpeg";
      const stored = await StoredFile.create({
        data: downloaded.buffer,
        contentType,
        kind: "telegram_upload",
      });

      const extraction = await classifyIngestion({
        imageBase64: downloaded.buffer.toString("base64"),
        imageContentType: contentType,
        text: text || undefined,
      });

      if (extraction.complete) {
        const reply = await saveExtractedRecord(extraction, { fileId: String(stored._id), userName });
        session.state = "idle";
        session.draft = undefined;
        session.history = [];
        await session.save();
        await sendMessage(chatId, reply);
      } else {
        session.state = "awaiting_metadata";
        session.draft = {
          docType: extraction.docType,
          fileId: String(stored._id),
          extracted: extraction.fields,
          missing: extraction.missing,
        };
        session.history = [{ role: "assistant", content: extraction.question }];
        await session.save();
        await sendMessage(
          chatId,
          `📷 Got it — looks like a <b>${extraction.docType.replace(/_/g, " ")}</b>.\n\n${extraction.question}\n\n<i>(send /cancel to start over)</i>`
        );
      }
      return NextResponse.json({ ok: true });
    }

    /* Text while we're collecting metadata for a draft */
    if (text && session.state === "awaiting_metadata" && session.draft) {
      session.history.push({ role: "user", content: text });
      const extraction = await classifyIngestion({
        text,
        priorDraft: {
          docType: session.draft.docType,
          fields: session.draft.extracted,
          missing: session.draft.missing,
        },
        history: session.history,
      });
      if (extraction.complete) {
        const reply = await saveExtractedRecord(extraction, {
          fileId: session.draft.fileId,
          userName,
        });
        session.state = "idle";
        session.draft = undefined;
        session.history = [];
        await session.save();
        await sendMessage(chatId, reply);
      } else {
        session.draft = {
          ...session.draft,
          docType: extraction.docType,
          extracted: extraction.fields,
          missing: extraction.missing,
        };
        session.history.push({ role: "assistant", content: extraction.question });
        session.markModified("draft");
        await session.save();
        await sendMessage(chatId, extraction.question);
      }
      return NextResponse.json({ ok: true });
    }

    /* Plain text, no active draft → company chatbot with full data access */
    if (text) {
      const reply = await companyChat([{ role: "user", content: text }]);
      await sendMessage(chatId, reply);
      return NextResponse.json({ ok: true });
    }

    await sendMessage(chatId, "Please send a photo (receipt, purchase request, damaged bag) or a message.");
  } catch (e) {
    console.error("telegram webhook error:", e);
    await sendMessage(chatId, "⚠️ Something went wrong on my side. Please try again.").catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
