import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import {
  BagLot,
  Brief,
  DamageClaim,
  Invoice,
  PurchaseRequest,
  Receipt,
  ShiftReport,
  StoneDelivery,
  StoredFile,
  TelegramSession,
} from "@/lib/models";
import { checkReceiptQRCode, classifyIngestion, scoreStonePhoto, verifyRequestLegitimacy, type IngestionExtraction } from "@/lib/llm";
import {
  answerCallbackQuery,
  CHANGE_CANCEL_KEYBOARD,
  downloadTelegramFile,
  REPORT_BUTTONS,
  sendInputTypeMenu,
  sendMessage,
  sendPurchaseDecisionRequest,
  sendReportMenu,
} from "@/lib/telegram";
import { processClaimPhoto } from "@/lib/claims";
import { companyChat } from "@/lib/chat";
import { recomputeLotBalances } from "@/lib/metrics";
import { ingestOpsReport, isOpsReportText } from "@/lib/ops-report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Keys must match normaliseChoice(button label) exactly.
// normaliseChoice: trim → toLowerCase → strip leading emoji/symbols/whitespace → trim
const REPORT_CHOICES: Record<string, { docType: IngestionExtraction["docType"]; label: string; question: string }> = {
  "የተበላሹ ጆንያዎች": {
    docType: "damage_claim",
    label: REPORT_BUTTONS.damage,
    question: "📷 የተበላሹትን ከረጢቶች ፎቶ ይላኩ። በፎቶው መግለጫ (caption) ላይ የተበላሹትን ከረጢቶች ብዛት ይፃፉ።",
  },
  "ደረሰኝ": {
    docType: "receipt",
    label: REPORT_BUTTONS.receipt,
    question: "🧾 QR ኮድ ያለው ኦፊሴላዊ ደረሰኝ ፎቶ ይላኩ። ያለ QR ኮድ ደረሰኝ ተቀባይነት የለውም።",
  },
  "የግዢ ጥያቄ": {
    docType: "purchase_request",
    label: REPORT_BUTTONS.purchase,
    question: "📝 ዕቃውን ወይም አገልግሎቱን፣ የገንዘቡን መጠን እና ምክንያቱን ይፃፉ። ደጋፊ ማስረጃ ካለዎት ፎቶ ያያይዙ።",
  },
  "wht ደረሰኝ": {
    docType: "withholding_receipt",
    label: REPORT_BUTTONS.wht,
    question: "📄 የ3% ታክስ (WHT) ደረሰኝ ፎቶውን ከደረሰኝ ቁጥሩ (invoice number)፣ ከደንበኛው ስም እና ከገንዘቡ መጠን ጋር ይላኩ።",
  },
  "ሽያጭ / ክፍያ": {
    docType: "payment",
    label: REPORT_BUTTONS.sales,
    question: "💵 የክፍያ ማረጋገጫ ፎቶ ይላኩ፣ ወይም የደረሰኝ ቁጥሩን (invoice number)፣ ደንበኛውን፣ የገንዘቡን መጠን፣ የክፍያ ቀኑን እና የክፍያ መንገዱን ይፃፉ።",
  },
  "የጭነት መኪና ሁኔታ": {
    docType: "stone_delivery",
    label: REPORT_BUTTONS.truck,
    question: "🚚 የጭነት መኪናውን ወይም የድንጋዩን ፎቶ ከሰሌዳ ቁጥሩ፣ ከጭነት ብዛቱ፣ ከተጫነበት ማዕድን ማውጫ (ኳሪ) እና ከታወቀ የአሽከርካሪው ስም ጋር ይላኩ።",
  },
  "የፈረቃ ሪፖርት": {
    docType: "shift_report",
    label: REPORT_BUTTONS.shift,
    question: "🏭 የተሞሉ ከረጢቶችን ብዛት፣ የከረጢቱን ክብደት (25 ወይም 40 ኪ.ግ)፣ የሥራ መቋረጥ ደቂቃዎችን፣ ፈረቃውን እና ማናቸውንም ማስታወሻዎች ይፃፉ።",
  },
  "የዕለታዊ ክንውን ሪፖርት": {
    docType: "other" as IngestionExtraction["docType"],
    label: REPORT_BUTTONS.ops,
    question: "📊 የዕለታዊ ክንውን ሪፖርቱን እዚህ ይለጥፉ (paste)። ቀናትን፣ የገቡ/የወጡ/የቀሩ ዕቃዎችን ክፍሎች እና የከረጢት ብዛትን ያካትቱ።",
  },
};

function normaliseChoice(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/^[\p{Emoji}\p{S}\p{P}\s]+/u, "")
    .trim();
}

async function startReportDraft(
  session: any,
  choice: { docType: IngestionExtraction["docType"]; label: string; question: string }
) {
  session.state = "awaiting_input_type";
  session.draft = {
    docType: choice.docType,
    reportLabel: choice.label,
    prompt: choice.question,
    extracted: {},
    missing: [],
  };
  session.history = [{ role: "assistant", content: choice.question }];
  await session.save();
}

function inputModeFromText(text: string): "text" | "photo" | "photo_caption" | null {
  const choice = normaliseChoice(text);
  if (choice === "ዝርዝሩን ይፃፉ") return "text";
  if (choice === "ፎቶ ይላኩ") return "photo";
  if (choice === "ፎቶ + የጽሁፍ ማብራሪያ") return "photo_caption";
  return null;
}

function isMongoAccessError(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  return message.includes("MongoDB Atlas") || message.includes("IP") || message.includes("whitelist");
}

const PR_ACTION_STATUS: Record<string, string> = {
  approve: "approved",
  reject: "rejected",
  bought: "bought",
  disregard: "disregarded",
  defer: "deferred",
};

async function handlePurchaseCallback(data: string, callbackId: string, chatId: string, userName: string) {
  const [, rawAction, id] = data.split(":");
  const status = PR_ACTION_STATUS[rawAction] || "";
  if (!status || !id) {
    await answerCallbackQuery(callbackId, "❌ የተሳሳተ ተግባር።");
    return;
  }

  const pr = await PurchaseRequest.findByIdAndUpdate(
    id,
    { status, decidedBy: userName, decidedAt: new Date() },
    { new: true }
  );
  if (!pr) {
    await answerCallbackQuery(callbackId, "🔍 ጥያቄው አልተገኘም።");
    return;
  }

  await answerCallbackQuery(callbackId, `📌 ${status} ተብሎ ተመዝግቧል።`);
  await sendMessage(chatId, `🔔 የ<b>${pr.title}</b> ጥያቄ በ${userName} <b>${status}</b> ተብሎ ተመዝግቧል።`);
}

async function getPhotoBase64(fileId: string): Promise<{ base64: string; contentType: string } | null> {
  const file = await StoredFile.findById(fileId);
  if (!file) return null;
  return {
    base64: Buffer.from(file.data as unknown as Uint8Array).toString("base64"),
    contentType: file.contentType,
  };
}

async function saveExtractedRecord(extraction: IngestionExtraction, opts: { fileId?: string; userName: string }) {
  const f = extraction.fields as Record<string, any>;

  switch (extraction.docType) {
    case "receipt": {
      // Receipts must be photos — text-only is already blocked by photo_caption inputMode,
      // but guard here too for any path that reaches saveExtractedRecord without a file.
      if (!opts.fileId) {
        return "📷 ደረሰኝ ፎቶ ያስፈልጋል። QR ኮድ ያለው ኦፊሴላዊ ደረሰኝ ፎቶ ይላኩ።";
      }

      const photo = await getPhotoBase64(opts.fileId);
      if (!photo) {
        return "📷 ፎቶ አልተገኘም። እባክዎ ድጋሚ ይሞክሩ።";
      }

      // Run QR check and legitimacy check in parallel
      const [qrCheck, legitimacy] = await Promise.all([
        checkReceiptQRCode(photo.base64, photo.contentType).catch(() => ({ hasQRCode: true, confidence: 0, notes: "check_failed" })),
        verifyRequestLegitimacy(
          photo.base64, photo.contentType, "receipt",
          f.vendor ? `vendor: ${f.vendor}, amount: ${f.amount}` : undefined
        ).catch(() => undefined),
      ]);

      if (!qrCheck.hasQRCode) {
        return "❌ ፎቶው ላይ QR ኮድ አልተገኘም። እባክዎ QR ኮድ ያለው ኦፊሴላዊ ደረሰኝ ፎቶ ይላኩ።";
      }

      const receipt = await Receipt.create({
        vendor: String(f.vendor || "Unknown vendor"),
        client: f.client ? String(f.client) : undefined,
        amount: Number(f.amount) || 0,
        category: f.category ? String(f.category) : undefined,
        receiptDate: f.receiptDate ? new Date(String(f.receiptDate)) : new Date(),
        taxInvoiceNumber: f.taxInvoiceNumber ? String(f.taxInvoiceNumber) : undefined,
        photoFileId: opts.fileId || undefined,
        submittedBy: opts.userName,
        source: "telegram",
        legitimacy,
        meta: f,
      });
      const legitimacyNote = legitimacy ? ` · ተዓማኒነ፦ ${legitimacy.score}%` : "";
      return `🧾 ደረሰኝ ተቀምጧል፦ <b>${receipt.vendor}</b> — ${Number(receipt.amount).toLocaleString()} ETB${legitimacyNote}`;
    }
    case "purchase_request": {
      let legitimacy;
      if (opts.fileId) {
        const photo = await getPhotoBase64(opts.fileId);
        if (photo) {
          legitimacy = await verifyRequestLegitimacy(
            photo.base64, photo.contentType, "purchase_request",
            f.title ? `item: ${f.title}, amount: ${f.amount}` : undefined
          ).catch(() => undefined);
        }
      }
      const pr = await PurchaseRequest.create({
        title: String(f.title || "Purchase request"),
        amount: Number(f.amount) || 0,
        requestedBy: opts.userName,
        justification: f.justification ? String(f.justification) : undefined,
        photoFileId: opts.fileId || undefined,
        source: "telegram",
        status: "pending",
        legitimacy,
      });
      if (process.env.TELEGRAM_CEO_CHAT_ID) {
        await sendPurchaseDecisionRequest(process.env.TELEGRAM_CEO_CHAT_ID, {
          id: String(pr._id),
          title: pr.title,
          amount: pr.amount,
          requestedBy: pr.requestedBy,
          justification: pr.justification,
        }).catch(() => {});
      }
      const legitimacyNote = legitimacy ? ` · ተዓማኒነት፦ ${legitimacy.score}%` : "";
      return `🛒 የግዢ ጥያቄ ተቀምጧል፦ <b>${pr.title}</b> — ${Number(pr.amount).toLocaleString()} ETB${legitimacyNote} · ለባለቤቱ ማሳወቂያ ተልኳል።`;
    }

    case "damage_claim": {
      if (!opts.fileId) return "📷 ፎቶ ያስፈልጋል። እባክዎ የተበላሹትን ከረጢቶች ፎቶ ከብዛቱ ጋር አብረው ይላኩ።";

      const reportedCount = Number(f.quantity) || 0;
      if (!reportedCount) return "📝 የተበላሹትን ከረጢቶች ብዛት ያካትቱ።";

      const file = await StoredFile.findById(opts.fileId);
      if (!file) return "❌ ፎቶው አልተገኘም። እባክዎ ድጋሚ ይላኩ።";

      // Optionally link to a lot if the worker mentioned a lot code
      let lotId: any = undefined;
      if (f.lotCode) {
        const lot = await BagLot.findOne({
          lotCode: { $regex: `^${String(f.lotCode).trim()}$`, $options: "i" },
        }).lean();
        if (lot) lotId = lot._id;
      }

      const processed = await processClaimPhoto(
        Buffer.from(file.data as unknown as Uint8Array),
        file.contentType,
        "bag",
        reportedCount
      );
      const flags = new Set<string>(["telegram_needs_cosign", ...processed.flags]);

      await DamageClaim.create({
        ...(lotId ? { lotId } : {}),
        quantity: reportedCount,
        source: "telegram",
        worker: opts.userName,
        photos: [processed.photo],
        flags: Array.from(flags),
        status: "cosign_required",
        capturedAt: new Date(),
        trustScore: processed.trustScore,
        aiCountedBags: processed.photo.ai?.aiCountedBags ?? undefined,
      });
      await recomputeLotBalances();

      const trustLevel =
        processed.trustScore >= 70 ? "ከፍተኛ" : processed.trustScore >= 40 ? "መካከለኛ" : "ዝቅተኛ";
      const aiNote =
        processed.photo.ai?.aiCountedBags !== null && processed.photo.ai?.aiCountedBags !== undefined
          ? ` · በ-AI የተቆጠረው፦ ${processed.photo.ai.aiCountedBags} ከረጢቶች`
          : "";
      const mismatchNote = flags.has("count_mismatch")
        ? "\n⚠️ የቁጥር አለመጣጣም ታይቷል — ተቆጣጣሪው ያረጋግጣል።"
        : "";
      return (
        `🛡️ የ${reportedCount} ከረጢቶች ብልሽት ሪፖርት ተቀምጧል${aiNote}።\n` +
        `🔍 የ-AI እምነት ደረጃ፦ <b>${processed.trustScore}%</b> (${trustLevel})` +
        mismatchNote +
        `\n\nየተቆጣጣሪ ፊርማ ያስፈልጋል።`
      );
    }

    case "stone_delivery": {
      let aiScore;
      if (opts.fileId) {
        const file = await StoredFile.findById(opts.fileId);
        if (file) aiScore = await scoreStonePhoto(Buffer.from(file.data as unknown as Uint8Array).toString("base64"), file.contentType);
      }
      const qualityGrade = ["good", "fair", "dark/weathered"].includes(f.qualityGrade)
        ? f.qualityGrade
        : aiScore?.qualityGrade || "good";
      await StoneDelivery.create({
        truckPlate: String(f.truckPlate || "UNKNOWN").toUpperCase(),
        supplier: f.supplier ? String(f.supplier) : undefined,
        quarry: f.quarry ? String(f.quarry) : undefined,
        driverName: f.driverName ? String(f.driverName) : undefined,
        gateClerk: opts.userName,
        loads: Number(f.loads) || 1,
        qualityGrade,
        photoFileId: opts.fileId || undefined,
        aiScore,
        notes: f.notes ? String(f.notes) : aiScore?.recommendation,
        date: new Date(),
      });
      return `🚚 የጭነት መኪና ማድረሻ ተቀምጧል፦ <b>${f.truckPlate || "UNKNOWN"}</b>፣ ${Number(f.loads) || 1} ጭነት(ቶች)፣ ጥራት፦ ${qualityGrade}።`;
    }

    case "shift_report": {
      const bagWeightKg = [25, 40].includes(Number(f.bagWeightKg)) ? Number(f.bagWeightKg) : undefined;
      const filledSacks = Number(f.filledSacks) || 0;
      await ShiftReport.create({
        supervisor: opts.userName,
        filledSacks,
        bagWeightKg,
        downtimeMinutes: Number(f.downtimeMinutes) || 0,
        shift: f.shift === "night" ? "night" : "day",
        notes: f.notes ? String(f.notes) : undefined,
        date: new Date(),
      });
      const tons = bagWeightKg ? (filledSacks * bagWeightKg / 1000).toFixed(2) : null;
      const tonsStr = tons ? ` (${tons} ቶን)` : "";
      return `🏭 የፈረቃ ሪፖርት ተቀምጧል፦ ${filledSacks} ከረጢቶች${tonsStr}፣ ${Number(f.downtimeMinutes) || 0} ደቂቃ የሥራ መቋረጥ።`;
    }

    case "invoice": {
      const bagWeightKg = [25, 40].includes(Number(f.bagWeightKg)) ? Number(f.bagWeightKg) : undefined;
      const invoice = await Invoice.create({
        invoiceNumber: String(f.invoiceNumber || `TG-${Date.now()}`),
        client: String(f.client || "Unknown client"),
        clientPhone: f.clientPhone ? String(f.clientPhone) : undefined,
        sacks: Number(f.sacks) || 0,
        bagWeightKg,
        amount: Number(f.amount) || 0,
        invoicedAt: f.invoiceDate ? new Date(String(f.invoiceDate)) : new Date(),
        dueDate: f.dueDate ? new Date(String(f.dueDate)) : new Date(Date.now() + 30 * 86400000),
        payments: [],
        withholdingReceiptReceived: false,
        notes: f.notes ? String(f.notes) : undefined,
      });
      return `💵 የሽያጭ ደረሰኝ ተቀምጧል፦ <b>${invoice.invoiceNumber}</b> — ${invoice.client} — ${Number(invoice.amount).toLocaleString()} ETB።`;
    }

    case "payment": {
      const invoiceNumber = String(f.invoiceNumber || "").trim();
      if (!invoiceNumber) return "🔢 ለዚህ ክፍያ የደረሰኝ ቁጥሩን (invoice number) ያካትቱ።";

      const invoice = await Invoice.findOne({ invoiceNumber: { $regex: `^${invoiceNumber}$`, $options: "i" } });
      if (!invoice) return `🔍 የደረሰኝ ቁጥር <b>${invoiceNumber}</b> አልተገኘም። እባክዎ መጀመሪያ የሽያጭ ደረሰኙን ይላኩ፣ ወይም ቁጥሩን ያስተካክሉ።`;

      invoice.payments = invoice.payments || [];
      invoice.payments.push({
        amount: Number(f.amount) || 0,
        date: f.paymentDate ? new Date(String(f.paymentDate)) : new Date(),
        method: f.method ? String(f.method) : "telegram",
      });
      await invoice.save();
      return `💵 የክፍያ መረጃ ለ<b>${invoice.invoiceNumber}</b> ተቀምጧል፦ ${Number(f.amount || 0).toLocaleString()} ETB።`;
    }

    case "withholding_receipt": {
      const invoiceNumber = String(f.invoiceNumber || "").trim();
      if (!invoiceNumber) return "🔢 የደረሰኝ ቁጥሩን (invoice number) ያካትቱ።";

      const invoice = await Invoice.findOne({ invoiceNumber: { $regex: `^${invoiceNumber}$`, $options: "i" } });
      if (!invoice) return `🔍 የደረሰኝ ቁጥር <b>${invoiceNumber}</b> አልተገኘም። እባክዎ ትክክለኛውን ቁጥር ይላኩ።`;

      invoice.withholdingReceiptReceived = true;
      invoice.withholdingReceiptReceivedAt = f.receiptDate ? new Date(String(f.receiptDate)) : new Date();
      invoice.withholdingReceiptFileId = opts.fileId as any;
      await invoice.save();
      return `📄 የታክስ ደረሰኝ ለ<b>${invoice.invoiceNumber}</b> (${invoice.client}) ተቀምጧል።`;
    }

    default:
      return "✅ ደርሷል። ከማውጫው (menu) ውስጥ የሪፖርት ዓይነት ይምረጡ።";
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const provided = req.nextUrl.searchParams.get("secret") || req.headers.get("x-telegram-bot-api-secret-token");
  if (secret && provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const update = await req.json().catch(() => null);

  const cb = update?.callback_query;
  if (cb?.id && cb?.data) {
    const chatId = String(cb.message?.chat?.id || cb.from?.id);
    const userName = [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(" ") || cb.from?.username || "Telegram user";
    try {
      await dbConnect();
      if (String(cb.data).startsWith("pr:")) {
        await handlePurchaseCallback(String(cb.data), String(cb.id), chatId, userName);
      } else {
        await answerCallbackQuery(String(cb.id), "❌ የተሳሳተ ተግባር።");
      }
    } catch (e) {
      console.error("telegram callback error:", e);
      await answerCallbackQuery(String(cb.id), "🛑 የዴታቤዝ ግንኙነት አልተሳካም። እባክዎ ድጋሚ ይሞክሩ።");
    }
    return NextResponse.json({ ok: true });
  }

  const msg = update?.message;
  if (!msg?.chat?.id) return NextResponse.json({ ok: true });

  const chatId = String(msg.chat.id);
  const userName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || msg.from?.username || "Telegram user";
  const text: string = msg.text || msg.caption || "";

  if (text.startsWith("/start") || text.startsWith("/report")) {
    await sendReportMenu(chatId, `👋 እንኳን ደህና መጡ ${userName}። የሪፖርት ዓይነት ይምረጡ።`);
    try {
      await dbConnect();
      const session =
        (await TelegramSession.findOne({ chatId })) ||
        (await TelegramSession.create({ chatId, userName, state: "idle", history: [] }));
      session.userName = userName;
      session.state = "idle";
      await session.save();
    } catch (e) {
      console.error("telegram start session save failed:", e);
      await sendMessage(
        chatId,
        "🔗 ቴሌግራም ተገናኝቷል፤ ነገር ግን የዴታቤዝ ግንኙነት ገና አልተሳካም። የ-MongoDB Atlas ችግር ሲፈታ ሪፖርቶች ይቀመጣሉ።"
      ).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }

  try {
    await dbConnect();

    if (text.startsWith("/brief")) {
      const brief = await Brief.findOne().sort({ date: -1 }).lean();
      if (!brief) {
        await sendMessage(chatId, "⏳ እስካሁን ምንም ማጠቃለያ (brief) አልተዘጋጀም።");
      } else {
        const ex =
          brief.exceptions.length > 0
            ? `<b>ልዩ ሁኔታዎች</b>\n${brief.exceptions.map((e: string) => `- ${e}`).join("\n")}\n\n`
            : "ምንም ልዩ ሁኔታ የለም።\n\n";
        await sendMessage(chatId, `<b>የጠዋት ሪፖርት - ${brief.date}</b>\n\n${ex}${brief.fiveLines.join("\n")}\n\n<i>${brief.narrative}</i>`);
      }
      return NextResponse.json({ ok: true });
    }

    if (text.startsWith("/cancel") || normaliseChoice(text) === "ሰርዝ") {
      await TelegramSession.findOneAndUpdate({ chatId }, { state: "idle", draft: null, history: [] });
      await sendReportMenu(chatId, "❌ ተሰርዟል። እባክዎ አዲስ የሪፖርት ዓይነት ይምረጡ።");
      return NextResponse.json({ ok: true });
    }

    const session =
      (await TelegramSession.findOne({ chatId })) ||
      (await TelegramSession.create({ chatId, userName, state: "idle", history: [] }));
    session.userName = userName;

    const normText = normaliseChoice(text);

    // Ops report: go straight to paste mode
    if (normText === "የዕለታዊ ክንውን ሪፖርት") {
      session.state = "awaiting_ops_report";
      session.draft = undefined;
      session.history = [];
      await session.save();
      await sendMessage(
        chatId,
        "📊 <b>የዕለታዊ ክንውን ሪፖርት</b>\n\nእባክዎ ሪፖርቱን አሁን ይለጥፉ (paste)።\nቀናትን፣ የገቡ/የወጡ/የቀሩ ዕቃዎችን ክፍሎች እና የከረጢት ብዛትን ያካትቱ።",
        { reply_markup: CHANGE_CANCEL_KEYBOARD }
      );
      return NextResponse.json({ ok: true });
    }

    // Handle ops report text submission
    if (session.state === "awaiting_ops_report" && text) {
      if (!isOpsReportText(text)) {
        await sendMessage(
          chatId,
          "⚠️ ይህ የክንውን ሪፖርት አይመስልም። ሪፖርቱ ቀናትን (ምሳሌ፦ 31/3/2026) እና የገቡ/የወጡ/የቀሩ ዕቃዎችን ክፍሎች መያዝ አለበት።\n\nእባክዎ ድጋሚ ይሞክሩ ወይም ❌ ሰርዝ የሚለውን ይጫኑ።",
          { reply_markup: CHANGE_CANCEL_KEYBOARD }
        );
        return NextResponse.json({ ok: true });
      }
      const result = await ingestOpsReport(text, userName);
      session.state = "idle";
      session.draft = undefined;
      await session.save();
      await sendMessage(
        chatId,
        `✅ ሪፖርት ተቀምጧል፦ <b>${result.saved}</b> አዲስ ቀን(ናት) ተመዝግቧል፣ <b>${result.updated}</b> ተሻሽሏል።\n\nቀናት፦ ${result.entries.map((e) => e.dateLabel).join(", ")}`
      );
      await sendReportMenu(chatId);
      return NextResponse.json({ ok: true });
    }

    const choice = REPORT_CHOICES[normText];
    if (choice) {
      const textOnly = choice.docType === "shift_report";
      session.state = "awaiting_metadata";
      session.draft = {
        docType: choice.docType,
        reportLabel: choice.label,
        prompt: choice.question,
        inputMode: textOnly ? "text" : "photo_caption",
        extracted: {},
        missing: [],
      };
      session.history = [{ role: "assistant", content: choice.question }];
      await session.save();
      const msg2 = textOnly
        ? `<b>${choice.label}</b>\n\n${choice.question}\n\nመልክቱን በ1 መስመር ይግለጹ`
        : `<b>${choice.label}</b>\n\n${choice.question}\n\n📷 ፎቶ ያስፈልጋል። ፎቶውን ይላኩ — ዝርዝሩን በፎቶው መግለጫ ላይ ያካትቱ።`;
      await sendMessage(chatId, msg2, { reply_markup: CHANGE_CANCEL_KEYBOARD });
      return NextResponse.json({ ok: true });
    }

    if (normText === "የሪፖርት ዓይነት ይቀይሩ") {
      session.state = "idle";
      session.draft = undefined;
      session.history = [];
      await session.save();
      await sendReportMenu(chatId, "➡️ የሪፖርት ዓይነት ይምረጡ።");
      return NextResponse.json({ ok: true });
    }

    if (normText === "የድርጅት ጥያቄ") {
      session.state = "idle";
      session.draft = undefined;
      await session.save();
      await sendMessage(chatId, "💬 የድርጅት ጥያቄዎን በአንድ መልዕክት ብቻ ይፃፉ።");
      return NextResponse.json({ ok: true });
    }

    const photoSizes = msg.photo as { file_id: string }[] | undefined;
    const docIsImage = msg.document?.mime_type?.startsWith("image/");
    if (photoSizes?.length || docIsImage) {
      const tgFileId = docIsImage ? msg.document.file_id : photoSizes![photoSizes!.length - 1].file_id;
      const downloaded = await downloadTelegramFile(tgFileId);
      if (!downloaded) {
        await sendMessage(chatId, "⚠️ ፋይሉን ማውረድ አልተቻለም። እባክዎ ድጋሚ ይሞክሩ።");
        return NextResponse.json({ ok: true });
      }

      const contentType = docIsImage ? msg.document.mime_type : "image/jpeg";
      const stored = await StoredFile.create({ data: downloaded.buffer, contentType, kind: "telegram_upload" });
      const activeDraft =
        session.state === "awaiting_metadata" || session.state === "awaiting_input_type" ? session.draft : undefined;
      const extraction = await classifyIngestion({
        imageBase64: downloaded.buffer.toString("base64"),
        imageContentType: contentType,
        text: text || undefined,
        priorDraft: activeDraft
          ? { docType: activeDraft.docType, fields: activeDraft.extracted, missing: activeDraft.missing }
          : undefined,
        history: session.history,
      });

      if (extraction.complete) {
        const reply = await saveExtractedRecord(extraction, { fileId: String(stored._id), userName });
        session.state = "idle";
        session.draft = undefined;
        session.history = [];
        await session.save();
        await sendMessage(chatId, reply);
        await sendReportMenu(chatId);
      } else {
        session.state = "awaiting_metadata";
        session.draft = {
          ...session.draft,
          docType: extraction.docType,
          fileId: String(stored._id),
          extracted: extraction.fields,
          missing: extraction.missing,
        };
        session.history = [{ role: "assistant", content: extraction.question }];
        await session.save();
        await sendMessage(chatId, extraction.question, { reply_markup: CHANGE_CANCEL_KEYBOARD });
      }
      return NextResponse.json({ ok: true });
    }

    if (
      text &&
      (session.state === "awaiting_metadata" || session.state === "awaiting_input_type") &&
      session.draft
    ) {
      if (session.draft.inputMode === "photo_caption") {
        await sendMessage(
          chatId,
          "📷 ለዚህ ሪፖርት ፎቶ ያስፈልጋል። እባክዎ ፎቶውን ከዝርዝር መግለጫው ጋር አብረው ይላኩ። ጽሑፍ ብቻ ተቀባይነት የለውም።",
          { reply_markup: CHANGE_CANCEL_KEYBOARD }
        );
        return NextResponse.json({ ok: true });
      }

      session.state = "awaiting_metadata";
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
        const reply = await saveExtractedRecord(extraction, { fileId: session.draft.fileId, userName });
        session.state = "idle";
        session.draft = undefined;
        session.history = [];
        await session.save();
        await sendMessage(chatId, reply);
        await sendReportMenu(chatId);
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
        await sendMessage(chatId, extraction.question, { reply_markup: CHANGE_CANCEL_KEYBOARD });
      }
      return NextResponse.json({ ok: true });
    }

    if (text && isOpsReportText(text)) {
      const result = await ingestOpsReport(text, userName);
      await sendMessage(
        chatId,
        `✅ ሪፖርት ተቀምጧል፦ <b>${result.saved}</b> አዲስ ቀን(ናት) ተመዝግቧል፣ <b>${result.updated}</b> ተሻሽሏል።\n\nቀናት፦ ${result.entries.map((e) => e.dateLabel).join(", ")}`
      );
      await sendReportMenu(chatId);
      return NextResponse.json({ ok: true });
    }

    if (text) {
      const reply = await companyChat([{ role: "user", content: text }]);
      await sendMessage(chatId, reply);
      return NextResponse.json({ ok: true });
    }

    await sendReportMenu(chatId);
  } catch (e) {
    console.error("telegram webhook error:", e);
    await sendMessage(
      chatId,
      isMongoAccessError(e)
        ? "🛑 የዴታቤዝ (Database) ግንኙነት አልተሳካም። እባክዎ የ-MongoDB Atlas ችግር ሲፈታ ድጋሚ ይሞክሩ።"
        : "❌ የሆነ ስህተት ተከስቷል። እባክዎ ድጋሚ ይሞክሩ።"
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
