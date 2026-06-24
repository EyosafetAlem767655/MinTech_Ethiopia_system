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
import { classifyIngestion, scoreStonePhoto, verifyRequestLegitimacy, type IngestionExtraction } from "@/lib/llm";
import {
  answerCallbackQuery,
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

const REPORT_CHOICES: Record<string, { docType: IngestionExtraction["docType"]; label: string; question: string }> = {
  "damage bags": {
    docType: "damage_claim",
    label: REPORT_BUTTONS.damage,
    question: "Send a damaged bag photo with the lot code and damaged bag quantity.",
  },
  "report damaged bags": {
    docType: "damage_claim",
    label: REPORT_BUTTONS.damage,
    question: "Send a damaged bag photo with the lot code and damaged bag quantity.",
  },
  receipt: {
    docType: "receipt",
    label: REPORT_BUTTONS.receipt,
    question: "Send the receipt photo or type vendor, amount, category and date.",
  },
  "send receipt": {
    docType: "receipt",
    label: REPORT_BUTTONS.receipt,
    question: "Send the receipt photo or type vendor, amount, category and date.",
  },
  "purchase request": {
    docType: "purchase_request",
    label: REPORT_BUTTONS.purchase,
    question: "Type the item or service, amount and reason. Add a photo if there is supporting evidence.",
  },
  "wht receipt": {
    docType: "withholding_receipt",
    label: REPORT_BUTTONS.wht,
    question: "Send the 3% WHT receipt photo with invoice number, client and amount.",
  },
  "sales/payment": {
    docType: "payment",
    label: REPORT_BUTTONS.sales,
    question: "Send payment evidence or type invoice number, client, amount, payment date and method.",
  },
  "sales/payment report": {
    docType: "payment",
    label: REPORT_BUTTONS.sales,
    question: "Send payment evidence or type invoice number, client, amount, payment date and method.",
  },
  "truck delivery": {
    docType: "stone_delivery",
    label: REPORT_BUTTONS.truck,
    question: "Send a truck/stone photo with plate number, loads, source quarry and driver if known.",
  },
  "shift report": {
    docType: "shift_report",
    label: REPORT_BUTTONS.shift,
    question: "Type filled sacks, downtime minutes, shift and any notes.",
  },
  "daily ops report": {
    docType: "other" as IngestionExtraction["docType"],
    label: REPORT_BUTTONS.ops,
    question: "Paste the daily operations report text (dates, Delivered/Received/Stock sections).",
  },
  "ops report": {
    docType: "other" as IngestionExtraction["docType"],
    label: REPORT_BUTTONS.ops,
    question: "Paste the daily operations report text (dates, Delivered/Received/Stock sections).",
  },
};

function normaliseChoice(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/^[^a-z0-9%]+/i, "")
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
  if (choice === "type details") return "text";
  if (choice === "send photo") return "photo";
  if (choice === "photo + caption") return "photo_caption";
  return null;
}

function inputPrompt(mode: "text" | "photo" | "photo_caption", prompt: string) {
  if (mode === "text") return `${prompt}\n\nType the details in one message.`;
  if (mode === "photo") return `${prompt}\n\nSend the photo now. If needed, I will ask for missing details after reading it.`;
  return `${prompt}\n\nSend the photo with the key details in the caption.`;
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
    await answerCallbackQuery(callbackId, "Invalid action");
    return;
  }

  const pr = await PurchaseRequest.findByIdAndUpdate(
    id,
    { status, decidedBy: userName, decidedAt: new Date() },
    { new: true }
  );
  if (!pr) {
    await answerCallbackQuery(callbackId, "Request not found");
    return;
  }

  await answerCallbackQuery(callbackId, `Marked ${status}`);
  await sendMessage(chatId, `Purchase request <b>${pr.title}</b> marked <b>${status}</b> by ${userName}.`);
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
      let legitimacy;
      if (opts.fileId) {
        const photo = await getPhotoBase64(opts.fileId);
        if (photo) {
          legitimacy = await verifyRequestLegitimacy(
            photo.base64, photo.contentType, "receipt",
            f.vendor ? `vendor: ${f.vendor}, amount: ${f.amount}` : undefined
          ).catch(() => undefined);
        }
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
      const legitimacyNote = legitimacy ? ` · legitimacy: ${legitimacy.score}%` : "";
      return `Receipt saved: <b>${receipt.vendor}</b> - ETB ${Number(receipt.amount).toLocaleString()}${legitimacyNote}.`;
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
      const legitimacyNote = legitimacy ? ` · legitimacy: ${legitimacy.score}%` : "";
      return `Purchase request submitted: <b>${pr.title}</b> - ETB ${Number(pr.amount).toLocaleString()}${legitimacyNote}. The owner has been notified.`;
    }

    case "damage_claim": {
      if (!opts.fileId) return "Damage reports need a photo. Send the damaged bag photo with lot code and quantity.";

      const lot = await BagLot.findOne({
        lotCode: { $regex: `^${String(f.lotCode || "").trim()}$`, $options: "i" },
      });
      if (!lot) {
        const lots = await BagLot.find().select("lotCode").sort({ receivedAt: -1 }).limit(5).lean();
        return `I could not find lot <b>${f.lotCode || ""}</b>. Recent lots: ${lots.map((l) => l.lotCode).join(", ")}.`;
      }

      const file = await StoredFile.findById(opts.fileId);
      if (!file) return "I could not find the uploaded damage photo. Please resend it.";

      const processed = await processClaimPhoto(
        Buffer.from(file.data as unknown as Uint8Array),
        file.contentType,
        lot.bagType
      );
      const flags = new Set<string>(["telegram_needs_cosign", ...processed.flags]);

      await DamageClaim.create({
        lotId: lot._id,
        quantity: Number(f.quantity) || 1,
        source: "telegram",
        worker: opts.userName,
        photos: [processed.photo],
        flags: Array.from(flags),
        status: "cosign_required",
        capturedAt: new Date(),
      });
      await recomputeLotBalances();

      return `Damage claim recorded for lot <b>${lot.lotCode}</b> (${Number(f.quantity) || 1} bags). It needs supervisor co-signing.`;
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
      return `Truck delivery logged: <b>${f.truckPlate || "UNKNOWN"}</b>, ${Number(f.loads) || 1} load(s), grade: ${qualityGrade}.`;
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
      return `Shift report saved: ${Number(f.filledSacks) || 0} sacks filled, ${Number(f.downtimeMinutes) || 0} min downtime.`;
    }

    case "invoice": {
      const invoice = await Invoice.create({
        invoiceNumber: String(f.invoiceNumber || `TG-${Date.now()}`),
        client: String(f.client || "Unknown client"),
        clientPhone: f.clientPhone ? String(f.clientPhone) : undefined,
        sacks: Number(f.sacks) || 0,
        amount: Number(f.amount) || 0,
        invoicedAt: f.invoiceDate ? new Date(String(f.invoiceDate)) : new Date(),
        dueDate: f.dueDate ? new Date(String(f.dueDate)) : new Date(Date.now() + 30 * 86400000),
        payments: [],
        withholdingReceiptReceived: false,
        notes: f.notes ? String(f.notes) : undefined,
      });
      return `Sales invoice saved: <b>${invoice.invoiceNumber}</b> - ${invoice.client} - ETB ${Number(invoice.amount).toLocaleString()}.`;
    }

    case "payment": {
      const invoiceNumber = String(f.invoiceNumber || "").trim();
      if (!invoiceNumber) return "Please include the invoice number for this payment.";

      const invoice = await Invoice.findOne({ invoiceNumber: { $regex: `^${invoiceNumber}$`, $options: "i" } });
      if (!invoice) return `I could not find invoice <b>${invoiceNumber}</b>. Send the sales invoice first or correct the number.`;

      invoice.payments = invoice.payments || [];
      invoice.payments.push({
        amount: Number(f.amount) || 0,
        date: f.paymentDate ? new Date(String(f.paymentDate)) : new Date(),
        method: f.method ? String(f.method) : "telegram",
      });
      await invoice.save();
      return `Payment saved for <b>${invoice.invoiceNumber}</b>: ETB ${Number(f.amount || 0).toLocaleString()}.`;
    }

    case "withholding_receipt": {
      const invoiceNumber = String(f.invoiceNumber || "").trim();
      if (!invoiceNumber) return "Please include the invoice number shown on the WHT receipt.";

      const invoice = await Invoice.findOne({ invoiceNumber: { $regex: `^${invoiceNumber}$`, $options: "i" } });
      if (!invoice) return `I could not find invoice <b>${invoiceNumber}</b>. Please send the correct invoice number.`;

      invoice.withholdingReceiptReceived = true;
      invoice.withholdingReceiptReceivedAt = f.receiptDate ? new Date(String(f.receiptDate)) : new Date();
      invoice.withholdingReceiptFileId = opts.fileId as any;
      await invoice.save();
      return `WHT receipt saved for <b>${invoice.invoiceNumber}</b> (${invoice.client}).`;
    }

    default:
      return "Noted. Choose a report type from the menu or describe what you want to file.";
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
        await answerCallbackQuery(String(cb.id), "Unknown action");
      }
    } catch (e) {
      console.error("telegram callback error:", e);
      await answerCallbackQuery(String(cb.id), "Database is not reachable. Try again after Atlas Network Access is fixed.");
    }
    return NextResponse.json({ ok: true });
  }

  const msg = update?.message;
  if (!msg?.chat?.id) return NextResponse.json({ ok: true });

  const chatId = String(msg.chat.id);
  const userName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || msg.from?.username || "Telegram user";
  const text: string = msg.text || msg.caption || "";

  if (text.startsWith("/start") || text.startsWith("/report")) {
    await sendReportMenu(chatId, `Welcome, ${userName}. Choose the report section.`);
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
        "Telegram is connected, but the database is not reachable yet. Reports cannot be saved until MongoDB Atlas Network Access allows this Vercel app."
      ).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }

  try {
    await dbConnect();

    if (text.startsWith("/brief")) {
      const brief = await Brief.findOne().sort({ date: -1 }).lean();
      if (!brief) {
        await sendMessage(chatId, "No brief has been generated yet.");
      } else {
        const ex =
          brief.exceptions.length > 0
            ? `<b>Exceptions</b>\n${brief.exceptions.map((e: string) => `- ${e}`).join("\n")}\n\n`
            : "No exceptions.\n\n";
        await sendMessage(chatId, `<b>Morning Brief - ${brief.date}</b>\n\n${ex}${brief.fiveLines.join("\n")}\n\n<i>${brief.narrative}</i>`);
      }
      return NextResponse.json({ ok: true });
    }

    if (text.startsWith("/cancel") || normaliseChoice(text) === "cancel") {
      await TelegramSession.findOneAndUpdate({ chatId }, { state: "idle", draft: null, history: [] });
      await sendReportMenu(chatId, "Cancelled. Choose a new report type.");
      return NextResponse.json({ ok: true });
    }

    const session =
      (await TelegramSession.findOne({ chatId })) ||
      (await TelegramSession.create({ chatId, userName, state: "idle", history: [] }));
    session.userName = userName;

    // Ops report: skip input_type_menu and go straight to text paste
    if (
      normaliseChoice(text) === "daily ops report" ||
      normaliseChoice(text) === "ops report" ||
      normaliseChoice(text) === "📊 daily ops report"
    ) {
      session.state = "awaiting_ops_report";
      session.draft = undefined;
      session.history = [];
      await session.save();
      await sendMessage(
        chatId,
        "📊 <b>Daily Ops Report</b>\n\nPaste the report text now.\nInclude the dates, Delivered / Received / Stock sections and bag counts."
      );
      return NextResponse.json({ ok: true });
    }

    // Handle ops report text submission
    if (session.state === "awaiting_ops_report" && text) {
      if (!isOpsReportText(text)) {
        await sendMessage(
          chatId,
          "That doesn't look like an ops report. It should contain dates (e.g. 31/3/2026) and Delivered/Received/Stock sections.\n\nTry again or press ❌ Cancel."
        );
        return NextResponse.json({ ok: true });
      }
      const result = await ingestOpsReport(text, userName);
      session.state = "idle";
      session.draft = undefined;
      await session.save();
      await sendMessage(
        chatId,
        `✅ Ops report ingested: <b>${result.saved}</b> new day(s) saved, <b>${result.updated}</b> updated.\n\nDates: ${result.entries.map((e) => e.dateLabel).join(", ")}`
      );
      await sendReportMenu(chatId);
      return NextResponse.json({ ok: true });
    }

    const choice = REPORT_CHOICES[normaliseChoice(text)];
    if (choice) {
      await startReportDraft(session, choice);
      await sendInputTypeMenu(chatId, choice.label, choice.question);
      return NextResponse.json({ ok: true });
    }

    if (normaliseChoice(text) === "change report") {
      session.state = "idle";
      session.draft = undefined;
      session.history = [];
      await session.save();
      await sendReportMenu(chatId, "Choose the report section.");
      return NextResponse.json({ ok: true });
    }

    const inputMode = inputModeFromText(text);
    if (inputMode && session.state === "awaiting_input_type" && session.draft) {
      session.state = "awaiting_metadata";
      session.draft = { ...session.draft, inputMode };
      session.markModified("draft");
      await session.save();
      await sendMessage(chatId, inputPrompt(inputMode, String(session.draft.prompt || "Send the report details.")));
      return NextResponse.json({ ok: true });
    }

    if (normaliseChoice(text) === "ask company question") {
      session.state = "idle";
      session.draft = undefined;
      await session.save();
      await sendMessage(chatId, "Ask your company-data question in one message.");
      return NextResponse.json({ ok: true });
    }

    const photoSizes = msg.photo as { file_id: string }[] | undefined;
    const docIsImage = msg.document?.mime_type?.startsWith("image/");
    if (photoSizes?.length || docIsImage) {
      const tgFileId = docIsImage ? msg.document.file_id : photoSizes![photoSizes!.length - 1].file_id;
      const downloaded = await downloadTelegramFile(tgFileId);
      if (!downloaded) {
        await sendMessage(chatId, "I could not download that file. Please try again.");
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
        await sendMessage(chatId, extraction.question);
      }
      return NextResponse.json({ ok: true });
    }

    if (
      text &&
      (session.state === "awaiting_metadata" || session.state === "awaiting_input_type") &&
      session.draft
    ) {
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
        await sendMessage(chatId, extraction.question);
      }
      return NextResponse.json({ ok: true });
    }

    if (text && isOpsReportText(text)) {
      const result = await ingestOpsReport(text, userName);
      await sendMessage(
        chatId,
        `✅ Ops report detected and ingested: <b>${result.saved}</b> new day(s) saved, <b>${result.updated}</b> updated.\n\nDates: ${result.entries.map((e) => e.dateLabel).join(", ")}`
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
        ? "Database is not reachable from Vercel yet. Fix MongoDB Atlas Network Access, then try again."
        : "Something went wrong. Please try again."
    ).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
