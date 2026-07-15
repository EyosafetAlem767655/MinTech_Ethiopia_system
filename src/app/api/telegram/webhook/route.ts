import { NextRequest, NextResponse } from "next/server";
import sql, { first, isUuid } from "@/lib/sql";
import { getFileBytes, putFile } from "@/lib/storage";
import { loadSession, saveSession } from "@/lib/sessions";
import { latestBrief } from "@/lib/brief";
import {
  checkReceiptQRCode,
  classifyIngestion,
  scoreStonePhoto,
  verifyRequestLegitimacy,
  type IngestionExtraction,
} from "@/lib/llm";
import {
  answerCallbackQuery,
  CHANGE_CANCEL_KEYBOARD,
  BACK_KEYBOARD,
  deleteMessage,
  downloadTelegramFile,
  ENTRY_BUTTONS,
  NAV_BUTTONS,
  sendEntryMenu,
  sendExternalMenu,
  sendMessage,
  sendPurchaseDecisionRequest,
  sendReportMenu,
} from "@/lib/telegram";
import {
  attemptLogin,
  bindSession,
  chatLockRemainingMinutes,
  clearAuth,
  eatDateKey,
  logActivity,
  logoutUser,
  registerFailedChatAttempt,
  resetChatAttempts,
  resolveSession,
} from "@/lib/bot-auth";
import {
  CAPABILITIES,
  capabilitiesFor,
  HR_KINDS,
  positionLabelsAm,
  type Capability,
  type HrKind,
} from "@/lib/positions";
import { insertClaimPhotos, processClaimPhoto } from "@/lib/claims";
import { companyChat } from "@/lib/chat";
import { ingestOpsReport, isOpsReportText } from "@/lib/ops-report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* ──────────────────────────── Text normalisation ─────────────────────────── */

/**
 * trim → lowercase → strip leading emoji/symbols/punctuation → trim
 *
 * `Default_Ignorable_Code_Point` is what makes this correct: 🛡️ is U+1F6E1
 * followed by variation selector U+FE0F, and 🧑‍🤝‍🧑 is joined by ZWJ. Stripping
 * only the pictographs leaves invisible codepoints behind that silently break
 * equality against the button label.
 */
function normaliseChoice(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/^[\p{Emoji}\p{Extended_Pictographic}\p{S}\p{P}\p{Default_Ignorable_Code_Point}\s]+/u, "")
    .trim();
}

/** Buttons are matched by their normalised label, so labels stay editable in one place. */
const CAP_BY_LABEL = new Map<string, Capability>(
  Object.values(CAPABILITIES).map((c) => [normaliseChoice(c.button), c])
);
const HR_KIND_BY_LABEL = new Map<string, HrKind>(
  (Object.keys(HR_KINDS) as HrKind[]).map((k) => [normaliseChoice(HR_KINDS[k].button), k])
);

const NORM = {
  entryReceipt: normaliseChoice(ENTRY_BUTTONS.receipt),
  entryInternal: normaliseChoice(ENTRY_BUTTONS.internal),
  cancel: normaliseChoice(NAV_BUTTONS.cancel),
  changeReport: normaliseChoice(NAV_BUTTONS.changeReport),
  back: normaliseChoice(NAV_BUTTONS.back),
  logout: normaliseChoice(NAV_BUTTONS.logout),
};

/* ──────────────────────────────── Amharic copy ───────────────────────────── */

const MSG = {
  welcome: "👋 እንኳን ደህና መጡ! ምን ማድረግ ይፈልጋሉ?",
  askLoginName: "👤 ሙሉ ስምዎን ይፃፉ (በዌብ ሲስተሙ ላይ እንደተመዘገበው)።",
  askLoginPassword:
    "🔑 የይለፍ ቃልዎን ይፃፉ።\n\n<i>ለደህንነት ሲባል የይለፍ ቃሉን የያዘው መልዕክት ወዲያውኑ ይሰረዛል።</i>",
  loginInvalid: "❌ ሙሉ ስም ወይም የይለፍ ቃል ትክክል አይደለም። እባክዎ ድጋሚ ይሞክሩ።",
  loginInactive: "⛔ መለያዎ ታግዷል። እባክዎ ከአስተዳዳሪው ጋር ይነጋገሩ።",
  loginCancelled: "↩️ ተመልሰዋል።",
  loggedOut: "👋 ከመለያዎ ወጥተዋል።",
  sessionRevoked: "🔒 ክፍለ ጊዜዎ ተዘግቷል። እባክዎ ድጋሚ ይግቡ።",
  noPermission: "⛔ ይህን ሪፖርት ለማስገባት ፈቃድ የለዎትም።",
  internalOnly: "🔐 ይህ ክፍል ለውስጥ ሰራተኞች ብቻ ነው። እባክዎ ይግቡ።",
  askExternalName: "👤 እባክዎ ሙሉ ስምዎን ይፃፉ።",
  askExternalPhone: "📞 እባክዎ ስልክ ቁጥርዎን ይፃፉ (ምሳሌ፦ 0912345678)።",
  badPhone: "⚠️ የስልክ ቁጥሩ ትክክል አይደለም። እባክዎ ድጋሚ ይፃፉ።",
  captureNeedsText: "📝 ጽሑፉንም ያክሉ። ፎቶው ተቀምጧል፤ አሁን ዝርዝሩን ይፃፉ።",
  pickReportFirst: "➡️ በመጀመሪያ ከምናሌው የሪፖርት ዓይነት ይምረጡ።",
  photoRequired:
    "📷 ለዚህ ሪፖርት ፎቶ ያስፈልጋል። እባክዎ ፎቶውን ከዝርዝር መግለጫው ጋር አብረው ይላኩ። ጽሑፍ ብቻ ተቀባይነት የለውም።",
  dbError: "🛑 የዴታቤዝ (Database) ግንኙነት አልተሳካም። እባክዎ የ-MongoDB Atlas ችግር ሲፈታ ድጋሚ ይሞክሩ።",
  genericError: "❌ የሆነ ስህተት ተከስቷል። እባክዎ ድጋሚ ይሞክሩ።",
  cancelled: "❌ ተሰርዟል።",
};

function lockedMessage(minutes: number) {
  return `⛔ በተደጋጋሚ የተሳሳተ ሙከራ ተደርጓል። እባክዎ ከ<b>${minutes}</b> ደቂቃ በኋላ ይሞክሩ።`;
}

/* ───────────────────────────── Session utilities ─────────────────────────── */

// jsonb columns replace Schema.Types.Mixed, so persisting is a plain upsert —
// no markModified. Kept as a thin wrapper so the many call sites don't change.
async function persist(session: any) {
  await saveSession(session);
}

/** Adapts a bot-auth BotUser (snake_case row) to the camelCase the webhook uses. */
function view(user: any) {
  return {
    _id: user.id,
    id: user.id,
    fullName: user.full_name,
    positions: user.positions || [],
    sessionEpoch: user.session_epoch,
    chatId: user.chat_id,
  };
}

function menuButtons(user: any): string[] {
  return capabilitiesFor(user.positions || []).map((c) => c.button);
}

async function sendRoleMenu(chatId: string, user: any, text?: string) {
  return sendReportMenu(chatId, menuButtons(user), text);
}

function actorOf(session: any, user?: any): string {
  if (user) return user.fullName;
  if (session.external?.fullName) return session.external.fullName;
  return session.userName || "Telegram user";
}

function audienceOf(session: any): "internal" | "external" | "unknown" {
  return session.mode === "internal" ? "internal" : session.mode === "external" ? "external" : "unknown";
}

/**
 * Re-validates the stored auth against the live user record. Returns null and
 * kicks the chat back to the entry menu if the account was deactivated, had its
 * password reset, or was re-bound to a different chat.
 */
async function currentUser(session: any, chatId: string): Promise<any | null> {
  const user = await resolveSession(session);
  if (user) {
    await sql`update telegram_users set last_seen_at = now() where id = ${user.id}`.catch(() => {});
    return view(user);
  }
  if (session.auth) {
    await logActivity({
      chatId,
      actor: actorOf(session),
      action: "session_revoked",
      ok: false,
      audience: "internal",
    });
    clearAuth(session);
    await persist(session);
    await sendEntryMenu(chatId, MSG.sessionRevoked);
  }
  return null;
}

/* ────────────────────────── Purchase decision callback ───────────────────── */

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

  if (!isUuid(id)) {
    await answerCallbackQuery(callbackId, "🔍 ጥያቄው አልተገኘም።");
    return;
  }
  const pr = first(await sql<{ title: string }[]>`
    update purchase_requests set status = ${status}, decided_by = ${userName}, decided_at = now()
     where id = ${id} returning title
  `);
  if (!pr) {
    await answerCallbackQuery(callbackId, "🔍 ጥያቄው አልተገኘም።");
    return;
  }

  await answerCallbackQuery(callbackId, `📌 ${status} ተብሎ ተመዝግቧል።`);
  await sendMessage(chatId, `🔔 የ<b>${pr.title}</b> ጥያቄ በ${userName} <b>${status}</b> ተብሎ ተመዝግቧል።`);
  await logActivity({
    chatId,
    actor: userName,
    action: "purchase_decision",
    detail: `${pr.title} → ${status}`,
    audience: "internal",
    meta: { purchaseRequestId: id, status },
  });
}

/* ──────────────────────────── Typed record writers ───────────────────────── */

async function getPhotoBase64(fileId: string): Promise<{ base64: string; contentType: string } | null> {
  const file = await getFileBytes(fileId);
  if (!file) return null;
  return { base64: file.base64, contentType: file.contentType };
}

/** Case-insensitive invoice lookup, replacing the old `{$regex: ^n$ /i}`. */
async function findInvoiceByNumber(invoiceNumber: string) {
  return first<{ id: string; client: string }>(await sql`
    select id, client from invoices where lower(invoice_number) = lower(${invoiceNumber}) limit 1
  `);
}

async function saveExtractedRecord(
  extraction: IngestionExtraction,
  opts: { fileId?: string; userName: string; meta?: Record<string, unknown> }
) {
  const f = extraction.fields as Record<string, any>;

  switch (extraction.docType) {
    case "receipt": {
      if (!opts.fileId) {
        return "📷 ደረሰኝ ፎቶ ያስፈልጋል። QR ኮድ ያለው ኦፊሴላዊ ደረሰኝ ፎቶ ይላኩ።";
      }

      const photo = await getPhotoBase64(opts.fileId);
      if (!photo) {
        return "📷 ፎቶ አልተገኘም። እባክዎ ድጋሚ ይሞክሩ።";
      }

      const [qrCheck, legitimacy] = await Promise.all([
        checkReceiptQRCode(photo.base64, photo.contentType).catch(() => ({
          hasQRCode: true,
          confidence: 0,
          notes: "check_failed",
        })),
        verifyRequestLegitimacy(
          photo.base64,
          photo.contentType,
          "receipt",
          f.vendor ? `vendor: ${f.vendor}, amount: ${f.amount}` : undefined
        ).catch(() => undefined),
      ]);

      if (!qrCheck.hasQRCode) {
        return "❌ ፎቶው ላይ QR ኮድ አልተገኘም። እባክዎ QR ኮድ ያለው ኦፊሴላዊ ደረሰኝ ፎቶ ይላኩ።";
      }

      const vendor = String(f.vendor || "Unknown vendor");
      const amount = Number(f.amount) || 0;
      await sql`
        insert into receipts (vendor, client, amount, category, receipt_date, tax_invoice_number,
                              photo_file_id, submitted_by, source, legitimacy, meta)
        values (${vendor}, ${f.client ? String(f.client) : null}, ${amount},
                ${f.category ? String(f.category) : null},
                ${f.receiptDate ? new Date(String(f.receiptDate)) : new Date()},
                ${f.taxInvoiceNumber ? String(f.taxInvoiceNumber) : null},
                ${opts.fileId || null}, ${opts.userName}, 'telegram',
                ${legitimacy ? sql.json(legitimacy as any) : null},
                ${sql.json({ ...f, ...(opts.meta || {}) })})
      `;
      const legitimacyNote = legitimacy ? ` · ተዓማኒነት፦ ${legitimacy.score}%` : "";
      return `🧾 ደረሰኝ ተቀምጧል፦ <b>${vendor}</b> — ${amount.toLocaleString()} ETB${legitimacyNote}`;
    }

    case "purchase_request": {
      let legitimacy;
      if (opts.fileId) {
        const photo = await getPhotoBase64(opts.fileId);
        if (photo) {
          legitimacy = await verifyRequestLegitimacy(
            photo.base64,
            photo.contentType,
            "purchase_request",
            f.title ? `item: ${f.title}, amount: ${f.amount}` : undefined
          ).catch(() => undefined);
        }
      }
      const prTitle = String(f.title || "Purchase request");
      const prAmount = Number(f.amount) || 0;
      const prJustification = f.justification ? String(f.justification) : null;
      const [pr] = await sql<{ id: string }[]>`
        insert into purchase_requests (title, amount, requested_by, justification, photo_file_id, source, status, legitimacy)
        values (${prTitle}, ${prAmount}, ${opts.userName}, ${prJustification}, ${opts.fileId || null},
                'telegram', 'pending', ${legitimacy ? sql.json(legitimacy as any) : null})
        returning id
      `;
      if (process.env.TELEGRAM_CEO_CHAT_ID) {
        await sendPurchaseDecisionRequest(process.env.TELEGRAM_CEO_CHAT_ID, {
          id: pr.id,
          title: prTitle,
          amount: prAmount,
          requestedBy: opts.userName,
          justification: prJustification || undefined,
        }).catch(() => {});
      }
      const legitimacyNote = legitimacy ? ` · ተዓማኒነት፦ ${legitimacy.score}%` : "";
      return `🛒 የግዢ ጥያቄ ተቀምጧል፦ <b>${prTitle}</b> — ${prAmount.toLocaleString()} ETB${legitimacyNote} · ለባለቤቱ ማሳወቂያ ተልኳል።`;
    }

    case "damage_claim": {
      if (!opts.fileId) return "📷 ፎቶ ያስፈልጋል። እባክዎ የተበላሹትን ከረጢቶች ፎቶ ከብዛቱ ጋር አብረው ይላኩ።";

      const reportedCount = Number(f.quantity) || 0;
      if (!reportedCount) return "📝 የተበላሹትን ከረጢቶች ብዛት ያካትቱ።";

      const file = await getFileBytes(opts.fileId);
      if (!file) return "❌ ፎቶው አልተገኘም። እባክዎ ድጋሚ ይላኩ።";

      let lotId: string | null = null;
      if (f.lotCode) {
        const lot = first<{ id: string }>(await sql`
          select id from bag_lots where lower(lot_code) = lower(${String(f.lotCode).trim()}) limit 1
        `);
        if (lot) lotId = lot.id;
      }

      const processed = await processClaimPhoto(file.buffer, file.contentType, "bag", reportedCount);
      const flags = new Set<string>(["telegram_needs_cosign", ...processed.flags]);

      const [claim] = await sql<{ id: string }[]>`
        insert into damage_claims (lot_id, quantity, source, worker, flags, status, captured_at, trust_score, ai_counted_bags)
        values (${lotId}, ${reportedCount}, 'telegram', ${opts.userName}, ${Array.from(flags)},
                'cosign_required', now(), ${processed.trustScore}, ${processed.photo.ai?.aiCountedBags ?? null})
        returning id
      `;
      await insertClaimPhotos(claim.id, [processed.photo]);

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
        const file = await getFileBytes(opts.fileId);
        if (file) aiScore = await scoreStonePhoto(file.base64, file.contentType);
      }
      const qualityGrade = ["good", "fair", "dark/weathered"].includes(f.qualityGrade)
        ? f.qualityGrade
        : aiScore?.qualityGrade || "good";
      const truckPlate = String(f.truckPlate || "UNKNOWN").toUpperCase();
      const loads = Number(f.loads) || 1;
      await sql`
        insert into stone_deliveries (truck_plate, supplier, quarry, driver_name, gate_clerk, loads, quality_grade, photo_file_id, ai_score, notes)
        values (${truckPlate}, ${f.supplier ? String(f.supplier) : null}, ${f.quarry ? String(f.quarry) : null},
                ${f.driverName ? String(f.driverName) : null}, ${opts.userName}, ${loads}, ${qualityGrade},
                ${opts.fileId || null}, ${aiScore ? sql.json(aiScore as any) : null},
                ${f.notes ? String(f.notes) : aiScore?.recommendation ?? null})
      `;
      return `🚚 የጭነት መኪና ማድረሻ ተቀምጧል፦ <b>${truckPlate}</b>፣ ${loads} ጭነት(ቶች)፣ ጥራት፦ ${qualityGrade}።`;
    }

    case "shift_report": {
      const bagWeightKg = [25, 40].includes(Number(f.bagWeightKg)) ? Number(f.bagWeightKg) : null;
      const filledSacks = Number(f.filledSacks) || 0;
      await sql`
        insert into shift_reports (supervisor, filled_sacks, bag_weight_kg, downtime_minutes, shift, notes)
        values (${opts.userName}, ${filledSacks}, ${bagWeightKg}, ${Number(f.downtimeMinutes) || 0},
                ${f.shift === "night" ? "night" : "day"}, ${f.notes ? String(f.notes) : null})
      `;
      const tons = bagWeightKg ? ((filledSacks * bagWeightKg) / 1000).toFixed(2) : null;
      const tonsStr = tons ? ` (${tons} ቶን)` : "";
      return `🏭 የፈረቃ ሪፖርት ተቀምጧል፦ ${filledSacks} ከረጢቶች${tonsStr}፣ ${Number(f.downtimeMinutes) || 0} ደቂቃ የሥራ መቋረጥ።`;
    }

    case "invoice": {
      const bagWeightKg = [25, 40].includes(Number(f.bagWeightKg)) ? Number(f.bagWeightKg) : null;
      const invoiceNumber = String(f.invoiceNumber || `TG-${Date.now()}`);
      const client = String(f.client || "Unknown client");
      const amount = Number(f.amount) || 0;
      await sql`
        insert into invoices (invoice_number, client, client_phone, sacks, bag_weight_kg, amount, invoiced_at, due_date, withholding_receipt_received, notes)
        values (${invoiceNumber}, ${client}, ${f.clientPhone ? String(f.clientPhone) : null},
                ${Number(f.sacks) || 0}, ${bagWeightKg}, ${amount},
                ${f.invoiceDate ? new Date(String(f.invoiceDate)) : new Date()},
                ${f.dueDate ? new Date(String(f.dueDate)) : new Date(Date.now() + 30 * 86400000)},
                false, ${f.notes ? String(f.notes) : null})
      `;
      return `💵 የሽያጭ ደረሰኝ ተቀምጧል፦ <b>${invoiceNumber}</b> — ${client} — ${amount.toLocaleString()} ETB።`;
    }

    case "payment": {
      const invoiceNumber = String(f.invoiceNumber || "").trim();
      if (!invoiceNumber) return "🔢 ለዚህ ክፍያ የደረሰኝ ቁጥሩን (invoice number) ያካትቱ።";

      const invoice = await findInvoiceByNumber(invoiceNumber);
      if (!invoice)
        return `🔍 የደረሰኝ ቁጥር <b>${invoiceNumber}</b> አልተገኘም። እባክዎ መጀመሪያ የሽያጭ ደረሰኙን ይላኩ፣ ወይም ቁጥሩን ያስተካክሉ።`;

      const amount = Number(f.amount) || 0;
      await sql`
        insert into payments (invoice_id, amount, date, method)
        values (${invoice.id}, ${amount},
                ${f.paymentDate ? new Date(String(f.paymentDate)) : new Date()},
                ${f.method ? String(f.method) : "telegram"})
      `;
      return `💵 የክፍያ መረጃ ለ<b>${invoiceNumber}</b> ተቀምጧል፦ ${amount.toLocaleString()} ETB።`;
    }

    case "withholding_receipt": {
      const invoiceNumber = String(f.invoiceNumber || "").trim();
      if (!invoiceNumber) return "🔢 የደረሰኝ ቁጥሩን (invoice number) ያካትቱ።";

      const invoice = await findInvoiceByNumber(invoiceNumber);
      if (!invoice) return `🔍 የደረሰኝ ቁጥር <b>${invoiceNumber}</b> አልተገኘም። እባክዎ ትክክለኛውን ቁጥር ይላኩ።`;

      await sql`
        update invoices set
          withholding_receipt_received = true,
          withholding_receipt_received_at = ${f.receiptDate ? new Date(String(f.receiptDate)) : new Date()},
          withholding_receipt_file_id = ${opts.fileId || null}
        where id = ${invoice.id}
      `;
      return `📄 የታክስ ደረሰኝ ለ<b>${invoiceNumber}</b> (${invoice.client}) ተቀምጧል።`;
    }

    default:
      return "✅ ደርሷል። ከማውጫው (menu) ውስጥ የሪፖርት ዓይነት ይምረጡ።";
  }
}

/** Writes the free-text capture types: daily report, material count, HR report. */
async function saveCapture(session: any, user: any): Promise<string> {
  const capture = session.capture || {};
  const photoFileIds = (capture.photoFileIds || []) as string[];
  const text = String(capture.text || "").trim();

  if (capture.capKey === "daily_report") {
    await sql`
      insert into daily_reports (user_id, full_name, positions, date_key, text, photo_file_ids, source)
      values (${user._id}, ${user.fullName}, ${user.positions}, ${eatDateKey()}, ${text}, ${photoFileIds}, 'telegram')
    `;
    const photoNote = photoFileIds.length ? ` · ${photoFileIds.length} ፎቶ(ዎች)` : "";
    return `✅ የቀኑ ሪፖርት ተቀምጧል${photoNote}። አመሰግናለሁ!`;
  }

  if (capture.capKey === "materials") {
    await sql`
      insert into material_counts (user_id, counted_by, date_key, raw_text, photo_file_ids)
      values (${user._id}, ${user.fullName}, ${eatDateKey()}, ${text}, ${photoFileIds})
    `;
    return `📦 የዕቃ ቆጠራ ተቀምጧል። አመሰግናለሁ!`;
  }

  if (capture.capKey === "hr") {
    const kind = (capture.hrKind || "customer_contact") as HrKind;
    await sql`
      insert into hr_reports (user_id, full_name, kind, text, photo_file_ids)
      values (${user._id}, ${user.fullName}, ${kind}, ${text}, ${photoFileIds})
    `;
    return `👥 ሪፖርት ተቀምጧል፦ <b>${HR_KINDS[kind].button}</b>።`;
  }

  return "✅ ደርሷል።";
}

/* ─────────────────────────────── Photo handling ──────────────────────────── */

async function storeIncomingPhoto(msg: any): Promise<{ id: string; buffer: Buffer; contentType: string } | null> {
  const photoSizes = msg.photo as { file_id: string }[] | undefined;
  const docIsImage = msg.document?.mime_type?.startsWith("image/");
  if (!photoSizes?.length && !docIsImage) return null;

  const tgFileId = docIsImage ? msg.document.file_id : photoSizes![photoSizes!.length - 1].file_id;
  const downloaded = await downloadTelegramFile(tgFileId);
  if (!downloaded) return null;

  const contentType = docIsImage ? msg.document.mime_type : "image/jpeg";
  const stored = await putFile(downloaded.buffer, contentType, { kind: "telegram_upload" });
  return { id: stored.id, buffer: downloaded.buffer, contentType };
}

function hasPhoto(msg: any): boolean {
  return Boolean((msg.photo as unknown[] | undefined)?.length || msg.document?.mime_type?.startsWith("image/"));
}

/* ────────────────────────────── Report starters ──────────────────────────── */

async function startLlmReport(session: any, chatId: string, cap: Capability) {
  session.state = "awaiting_metadata";
  session.capture = undefined;
  session.draft = {
    docType: cap.docType,
    reportLabel: cap.button,
    prompt: cap.question,
    inputMode: cap.input === "photo" ? "photo_caption" : "text",
    extracted: {},
    missing: [],
  };
  session.history = [{ role: "assistant", content: cap.question }];
  await persist(session);

  const suffix =
    cap.input === "photo"
      ? "\n\n📷 ፎቶ ያስፈልጋል። ፎቶውን ይላኩ — ዝርዝሩን በፎቶው መግለጫ ላይ ያካትቱ።"
      : "\n\nዝርዝሩን በአንድ መልዕክት ይፃፉ (ወይም ፎቶ ከመግለጫ ጋር ይላኩ)።";
  await sendMessage(chatId, `<b>${cap.button}</b>\n\n${cap.question}${suffix}`, {
    reply_markup: CHANGE_CANCEL_KEYBOARD,
  });
}

async function startCapture(session: any, chatId: string, cap: Capability, hrKind?: HrKind) {
  session.state = "awaiting_capture";
  session.draft = undefined;
  session.capture = { capKey: cap.key, hrKind, photoFileIds: [] };
  session.history = [];
  await persist(session);

  const question = hrKind ? HR_KINDS[hrKind].question : cap.question;
  const label = hrKind ? HR_KINDS[hrKind].button : cap.button;
  await sendMessage(chatId, `<b>${label}</b>\n\n${question}`, { reply_markup: CHANGE_CANCEL_KEYBOARD });
}

const HR_KIND_KEYBOARD = {
  keyboard: [
    ...(Object.keys(HR_KINDS) as HrKind[]).map((k) => [{ text: HR_KINDS[k].button }]),
    [{ text: NAV_BUTTONS.changeReport }, { text: NAV_BUTTONS.cancel }],
  ],
  resize_keyboard: true,
  one_time_keyboard: false,
};

/* ─────────────────────────────────── Route ───────────────────────────────── */

function isMongoAccessError(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  return message.includes("MongoDB Atlas") || message.includes("IP") || message.includes("whitelist");
}

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const provided =
    req.nextUrl.searchParams.get("secret") || req.headers.get("x-telegram-bot-api-secret-token");
  if (secret && provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const update = await req.json().catch(() => null);

  /* ── Inline-button callbacks (purchase decisions, owner only) ── */
  const cb = update?.callback_query;
  if (cb?.id && cb?.data) {
    const chatId = String(cb.message?.chat?.id || cb.from?.id);
    const userName =
      [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(" ") || cb.from?.username || "Telegram user";
    const ceoChatId = (process.env.TELEGRAM_CEO_CHAT_ID || "").trim();

    // Purchase approvals are irreversible spend decisions; only the owner's chat may make them.
    if (ceoChatId && chatId !== ceoChatId) {
      await answerCallbackQuery(String(cb.id), "⛔ ፈቃድ የለዎትም።");
      await logActivity({ chatId, actor: userName, action: "unauthorized", detail: `callback ${cb.data}`, ok: false }).catch(() => {});
      return NextResponse.json({ ok: true });
    }

    try {
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
  const messageId = Number(msg.message_id);
  const tgName =
    [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || msg.from?.username || "Telegram user";
  const text: string = msg.text || msg.caption || "";
  const normText = normaliseChoice(text);

  try {
    const session = await loadSession(chatId, tgName);
    session.userName = tgName;

    /* ── Password entry: consumed before any command or button routing ──
       The message is deleted from Telegram so the password does not sit in the
       chat history on the employee's phone. */
    if (session.state === "awaiting_login_password" && text) {
      if (normText === NORM.back || normText === NORM.cancel) {
        session.state = "idle";
        session.loginName = undefined;
        await persist(session);
        await sendEntryMenu(chatId, MSG.loginCancelled);
        return NextResponse.json({ ok: true });
      }

      await deleteMessage(chatId, messageId).catch(() => {});

      const lockMinutes = chatLockRemainingMinutes(session);
      if (lockMinutes > 0) {
        await sendMessage(chatId, lockedMessage(lockMinutes));
        return NextResponse.json({ ok: true });
      }

      const fullName = String(session.loginName || "");
      const result = await attemptLogin(fullName, text);

      if (!result.ok) {
        registerFailedChatAttempt(session);
        session.state = "idle";
        session.loginName = undefined;
        await persist(session);
        await logActivity({
          chatId,
          actor: fullName || tgName,
          action: result.reason === "locked" ? "login_locked" : "login_failed",
          detail: `name: ${fullName}`,
          ok: false,
        });

        const chatLock = chatLockRemainingMinutes(session);
        if (result.reason === "locked") {
          await sendEntryMenu(chatId, lockedMessage(result.retryAfterMinutes || 15));
        } else if (result.reason === "inactive") {
          await sendEntryMenu(chatId, MSG.loginInactive);
        } else if (chatLock > 0) {
          await sendEntryMenu(chatId, lockedMessage(chatLock));
        } else {
          await sendEntryMenu(chatId, MSG.loginInvalid);
        }
        return NextResponse.json({ ok: true });
      }

      const bound = await bindSession(result.user, chatId);
      const user = view(bound);
      resetChatAttempts(session);
      session.mode = "internal";
      session.state = "idle";
      session.loginName = undefined;
      session.draft = undefined;
      session.capture = undefined;
      session.history = [];
      session.auth = {
        userId: user._id,
        fullName: user.fullName,
        positions: user.positions,
        sessionEpoch: user.sessionEpoch,
        loggedInAt: new Date(),
      };
      await persist(session);

      await logActivity({
        chatId,
        actor: user.fullName,
        userId: user._id,
        positions: user.positions,
        audience: "internal",
        action: "login_success",
      });
      await sendRoleMenu(
        chatId,
        user,
        `✅ እንኳን ደህና መጡ <b>${user.fullName}</b>።\n🏷️ የሥራ መደብ፦ ${positionLabelsAm(user.positions) || "—"}\n\n➡️ የሪፖርት ዓይነት ይምረጡ።`
      );
      return NextResponse.json({ ok: true });
    }

    /* ── /start: always returns to the entry menu ── */
    if (text.startsWith("/start")) {
      const wasInternal = Boolean(session.auth);
      const resolved = wasInternal ? await resolveSession(session) : null;
      const user = resolved ? view(resolved) : null;
      if (user) {
        await sendRoleMenu(chatId, user, `👋 እንኳን ደህና መጡ <b>${user.fullName}</b>።`);
      } else {
        if (session.auth) clearAuth(session);
        session.state = "idle";
        session.mode = "unknown";
        session.draft = undefined;
        session.capture = undefined;
        session.history = [];
        await persist(session);
        await sendEntryMenu(chatId, MSG.welcome);
      }
      await logActivity({ chatId, actor: actorOf(session, user), action: "start", audience: audienceOf(session) });
      return NextResponse.json({ ok: true });
    }

    /* ── Logout ── */
    if (text.startsWith("/logout") || normText === NORM.logout) {
      const name = session.auth?.fullName || tgName;
      const wasInternal = Boolean(session.auth);
      await logoutUser(session);
      await persist(session);
      if (wasInternal) {
        await logActivity({ chatId, actor: name, action: "logout", audience: "internal" });
      }
      await sendEntryMenu(chatId, MSG.loggedOut);
      return NextResponse.json({ ok: true });
    }

    /* ── Brief (owner convenience command) ── */
    if (text.startsWith("/brief")) {
      const brief = (await latestBrief()) as any;
      if (!brief) {
        await sendMessage(chatId, "⏳ እስካሁን ምንም ማጠቃለያ (brief) አልተዘጋጀም።");
      } else {
        const exceptions: string[] = brief.exceptions || [];
        const ex =
          exceptions.length > 0
            ? `<b>ልዩ ሁኔታዎች</b>\n${exceptions.map((e) => `- ${e}`).join("\n")}\n\n`
            : "ምንም ልዩ ሁኔታ የለም።\n\n";
        await sendMessage(
          chatId,
          `<b>የጠዋት ሪፖርት - ${brief.date}</b>\n\n${ex}${(brief.fiveLines || []).join("\n")}\n\n<i>${brief.narrative || ""}</i>`
        );
      }
      return NextResponse.json({ ok: true });
    }

    /* ── Cancel / back out of a report ── */
    if (text.startsWith("/cancel") || normText === NORM.cancel || normText === NORM.changeReport) {
      session.state = "idle";
      session.draft = undefined;
      session.capture = undefined;
      session.history = [];
      await persist(session);

      const user = await currentUser(session, chatId);
      if (user) await sendRoleMenu(chatId, user, `${MSG.cancelled} እባክዎ የሪፖርት ዓይነት ይምረጡ።`);
      else if (session.mode === "external") await sendExternalMenu(chatId, MSG.cancelled);
      else await sendEntryMenu(chatId, MSG.cancelled);
      return NextResponse.json({ ok: true });
    }

    /* ── Login name entry ── */
    if (session.state === "awaiting_login_name" && text) {
      if (normText === NORM.back) {
        session.state = "idle";
        await persist(session);
        await sendEntryMenu(chatId, MSG.loginCancelled);
        return NextResponse.json({ ok: true });
      }
      session.loginName = text.trim();
      session.state = "awaiting_login_password";
      await persist(session);
      await sendMessage(chatId, MSG.askLoginPassword, { reply_markup: BACK_KEYBOARD });
      return NextResponse.json({ ok: true });
    }

    /* ── External identity capture (name → phone) ── */
    if (session.state === "awaiting_external_name" && text) {
      if (normText === NORM.back) {
        session.state = "idle";
        session.mode = "unknown";
        await persist(session);
        await sendEntryMenu(chatId, MSG.welcome);
        return NextResponse.json({ ok: true });
      }
      session.external = { fullName: text.trim(), phone: "" };
      session.state = "awaiting_external_phone";
      await persist(session);
      await sendMessage(chatId, MSG.askExternalPhone, { reply_markup: BACK_KEYBOARD });
      return NextResponse.json({ ok: true });
    }

    if (session.state === "awaiting_external_phone" && text) {
      if (normText === NORM.back) {
        session.state = "awaiting_external_name";
        await persist(session);
        await sendMessage(chatId, MSG.askExternalName, { reply_markup: BACK_KEYBOARD });
        return NextResponse.json({ ok: true });
      }
      const phone = text.trim();
      if (!/^\+?[\d\s-]{7,20}$/.test(phone)) {
        await sendMessage(chatId, MSG.badPhone, { reply_markup: BACK_KEYBOARD });
        return NextResponse.json({ ok: true });
      }
      session.external = { fullName: session.external?.fullName || tgName, phone };
      session.mode = "external";
      await persist(session);
      await logActivity({
        chatId,
        actor: session.external.fullName,
        action: "external_registered",
        audience: "external",
        detail: phone,
      });
      await startLlmReport(session, chatId, CAPABILITIES.receipt);
      return NextResponse.json({ ok: true });
    }

    /* ── Entry menu: the two doors ── */
    if (normText === NORM.entryInternal) {
      session.state = "awaiting_login_name";
      session.draft = undefined;
      session.capture = undefined;
      await persist(session);
      await sendMessage(chatId, `🔐 <b>ለውስጥ ሰራተኛ ብቻ</b>\n\n${MSG.askLoginName}`, {
        reply_markup: BACK_KEYBOARD,
      });
      return NextResponse.json({ ok: true });
    }

    if (normText === NORM.entryReceipt) {
      const user = await currentUser(session, chatId);
      if (user) {
        await startLlmReport(session, chatId, CAPABILITIES.receipt);
        return NextResponse.json({ ok: true });
      }
      if (!session.external?.phone) {
        session.mode = "external";
        session.state = "awaiting_external_name";
        await persist(session);
        await sendMessage(chatId, `🧾 <b>ደረሰኝ ማስገባት</b>\n\n${MSG.askExternalName}`, {
          reply_markup: BACK_KEYBOARD,
        });
        return NextResponse.json({ ok: true });
      }
      session.mode = "external";
      await startLlmReport(session, chatId, CAPABILITIES.receipt);
      return NextResponse.json({ ok: true });
    }

    /* ── Back button at an idle external/internal menu ── */
    if (normText === NORM.back && session.state === "idle") {
      session.mode = session.auth ? session.mode : "unknown";
      await persist(session);
      const user = await currentUser(session, chatId);
      if (user) await sendRoleMenu(chatId, user);
      else await sendEntryMenu(chatId, MSG.welcome);
      return NextResponse.json({ ok: true });
    }

    /* ── Everything below needs an identity ── */
    const user = await currentUser(session, chatId);
    const isExternal = !user && session.mode === "external" && Boolean(session.external?.phone);

    if (!user && !isExternal) {
      await sendEntryMenu(chatId, MSG.welcome);
      return NextResponse.json({ ok: true });
    }

    const submitterName = user ? user.fullName : session.external!.fullName;
    const submitterMeta = user ? undefined : { submitterPhone: session.external!.phone, external: true };

    /* ── HR subtype choice ── */
    if (session.state === "awaiting_hr_kind" && text) {
      const kind = HR_KIND_BY_LABEL.get(normText);
      if (!kind) {
        await sendMessage(chatId, "➡️ እባክዎ ከታች ካሉት ምርጫዎች አንዱን ይጫኑ።", { reply_markup: HR_KIND_KEYBOARD });
        return NextResponse.json({ ok: true });
      }
      await startCapture(session, chatId, CAPABILITIES.hr, kind);
      return NextResponse.json({ ok: true });
    }

    /* ── Capability buttons ── */
    const cap = CAP_BY_LABEL.get(normText);
    if (cap) {
      const allowed = user
        ? capabilitiesFor(user.positions).some((c) => c.key === cap.key)
        : cap.key === "receipt";

      if (!allowed) {
        await logActivity({
          chatId,
          actor: submitterName,
          userId: user ? String(user._id) : undefined,
          positions: user?.positions,
          audience: audienceOf(session),
          action: "unauthorized",
          detail: cap.key,
          ok: false,
        });
        if (user) await sendRoleMenu(chatId, user, MSG.noPermission);
        else await sendExternalMenu(chatId, MSG.internalOnly);
        return NextResponse.json({ ok: true });
      }

      await logActivity({
        chatId,
        actor: submitterName,
        userId: user ? String(user._id) : undefined,
        positions: user?.positions,
        audience: audienceOf(session),
        action: "menu_select",
        detail: cap.key,
      });

      if (cap.key === "hr") {
        session.state = "awaiting_hr_kind";
        session.draft = undefined;
        session.capture = undefined;
        await persist(session);
        await sendMessage(chatId, `👥 <b>${cap.button}</b>\n\n${cap.question}`, { reply_markup: HR_KIND_KEYBOARD });
        return NextResponse.json({ ok: true });
      }

      if (cap.captureMode === "chat") {
        session.state = "idle";
        session.draft = undefined;
        session.capture = undefined;
        await persist(session);
        await sendMessage(chatId, cap.question);
        return NextResponse.json({ ok: true });
      }

      if (cap.captureMode === "ops_paste") {
        session.state = "awaiting_ops_report";
        session.draft = undefined;
        session.capture = undefined;
        session.history = [];
        await persist(session);
        await sendMessage(chatId, `📊 <b>${cap.button}</b>\n\n${cap.question}`, {
          reply_markup: CHANGE_CANCEL_KEYBOARD,
        });
        return NextResponse.json({ ok: true });
      }

      if (cap.captureMode === "capture") {
        await startCapture(session, chatId, cap);
        return NextResponse.json({ ok: true });
      }

      await startLlmReport(session, chatId, cap);
      return NextResponse.json({ ok: true });
    }

    /* ── Free-text/photo capture (daily report, materials, HR) ── */
    if (session.state === "awaiting_capture" && session.capture && user) {
      const photo = hasPhoto(msg) ? await storeIncomingPhoto(msg) : null;
      if (hasPhoto(msg) && !photo) {
        await sendMessage(chatId, "⚠️ ፎቶውን ማውረድ አልተቻለም። እባክዎ ድጋሚ ይሞክሩ።", {
          reply_markup: CHANGE_CANCEL_KEYBOARD,
        });
        return NextResponse.json({ ok: true });
      }

      const capture = { ...session.capture };
      capture.photoFileIds = [...(capture.photoFileIds || []), ...(photo ? [photo.id] : [])];
      if (text) capture.text = capture.text ? `${capture.text}\n${text}` : text;
      session.capture = capture;

      if (!capture.text) {
        await persist(session);
        await sendMessage(chatId, MSG.captureNeedsText, { reply_markup: CHANGE_CANCEL_KEYBOARD });
        return NextResponse.json({ ok: true });
      }

      const reply = await saveCapture(session, user);
      await logActivity({
        chatId,
        actor: user.fullName,
        userId: String(user._id),
        positions: user.positions,
        audience: "internal",
        action: "submission",
        detail: capture.capKey === "hr" ? `hr:${capture.hrKind}` : capture.capKey,
        meta: { photos: capture.photoFileIds.length },
      });

      session.state = "idle";
      session.capture = undefined;
      await persist(session);
      await sendMessage(chatId, reply);
      await sendRoleMenu(chatId, user);
      return NextResponse.json({ ok: true });
    }

    /* ── Pasted operations report ── */
    if (session.state === "awaiting_ops_report" && text) {
      if (!isOpsReportText(text)) {
        await sendMessage(
          chatId,
          "⚠️ ይህ የክንውን ሪፖርት አይመስልም። ሪፖርቱ ቀናትን (ምሳሌ፦ 31/3/2026) እና የገቡ/የወጡ/የቀሩ ዕቃዎችን ክፍሎች መያዝ አለበት።\n\nእባክዎ ድጋሚ ይሞክሩ ወይም ❌ ሰርዝ የሚለውን ይጫኑ።",
          { reply_markup: CHANGE_CANCEL_KEYBOARD }
        );
        return NextResponse.json({ ok: true });
      }
      const result = await ingestOpsReport(text, submitterName);
      session.state = "idle";
      session.draft = undefined;
      await persist(session);
      await logActivity({
        chatId,
        actor: submitterName,
        userId: user ? String(user._id) : undefined,
        positions: user?.positions,
        audience: "internal",
        action: "submission",
        detail: "ops",
        meta: { saved: result.saved, updated: result.updated },
      });
      await sendMessage(
        chatId,
        `✅ ሪፖርት ተቀምጧል፦ <b>${result.saved}</b> አዲስ ቀን(ናት) ተመዝግቧል፣ <b>${result.updated}</b> ተሻሽሏል።\n\nቀናት፦ ${result.entries
          .map((e) => e.dateLabel)
          .join(", ")}`
      );
      if (user) await sendRoleMenu(chatId, user);
      return NextResponse.json({ ok: true });
    }

    /* ── LLM ingestion: photo ── */
    if (hasPhoto(msg)) {
      if (session.state !== "awaiting_metadata" || !session.draft) {
        if (user) await sendRoleMenu(chatId, user, MSG.pickReportFirst);
        else await sendExternalMenu(chatId, MSG.pickReportFirst);
        return NextResponse.json({ ok: true });
      }

      const stored = await storeIncomingPhoto(msg);
      if (!stored) {
        await sendMessage(chatId, "⚠️ ፋይሉን ማውረድ አልተቻለም። እባክዎ ድጋሚ ይሞክሩ።");
        return NextResponse.json({ ok: true });
      }

      const extraction = await classifyIngestion({
        imageBase64: stored.buffer.toString("base64"),
        imageContentType: stored.contentType,
        text: text || undefined,
        priorDraft: {
          docType: session.draft.docType,
          fields: session.draft.extracted,
          missing: session.draft.missing,
        },
        history: session.history,
      });

      // The user picked the report type from a gated menu; the LLM must not
      // reclassify a receipt into, say, a purchase request they cannot file.
      const docType = session.draft.docType || extraction.docType;

      if (extraction.complete) {
        const reply = await saveExtractedRecord(
          { ...extraction, docType: docType as IngestionExtraction["docType"] },
          { fileId: stored.id, userName: submitterName, meta: submitterMeta }
        );
        await logActivity({
          chatId,
          actor: submitterName,
          userId: user ? String(user._id) : undefined,
          positions: user?.positions,
          audience: audienceOf(session),
          action: "submission",
          detail: docType,
          meta: { hasPhoto: true },
        });
        session.state = "idle";
        session.draft = undefined;
        session.history = [];
        await persist(session);
        await sendMessage(chatId, reply);
        if (user) await sendRoleMenu(chatId, user);
        else await sendExternalMenu(chatId, "🧾 ሌላ ደረሰኝ ለማስገባት ቁልፉን ይጫኑ።");
      } else {
        session.state = "awaiting_metadata";
        session.draft = {
          ...session.draft,
          docType,
          fileId: stored.id,
          extracted: extraction.fields,
          missing: extraction.missing,
        };
        session.history = [{ role: "assistant", content: extraction.question }];
        await persist(session);
        await sendMessage(chatId, extraction.question, { reply_markup: CHANGE_CANCEL_KEYBOARD });
      }
      return NextResponse.json({ ok: true });
    }

    /* ── LLM ingestion: follow-up text ── */
    if (text && session.state === "awaiting_metadata" && session.draft) {
      if (session.draft.inputMode === "photo_caption" && !session.draft.fileId) {
        await sendMessage(chatId, MSG.photoRequired, { reply_markup: CHANGE_CANCEL_KEYBOARD });
        return NextResponse.json({ ok: true });
      }

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
      const docType = session.draft.docType || extraction.docType;

      if (extraction.complete) {
        const reply = await saveExtractedRecord(
          { ...extraction, docType: docType as IngestionExtraction["docType"] },
          { fileId: session.draft.fileId, userName: submitterName, meta: submitterMeta }
        );
        await logActivity({
          chatId,
          actor: submitterName,
          userId: user ? String(user._id) : undefined,
          positions: user?.positions,
          audience: audienceOf(session),
          action: "submission",
          detail: docType,
        });
        session.state = "idle";
        session.draft = undefined;
        session.history = [];
        await persist(session);
        await sendMessage(chatId, reply);
        if (user) await sendRoleMenu(chatId, user);
        else await sendExternalMenu(chatId, "🧾 ሌላ ደረሰኝ ለማስገባት ቁልፉን ይጫኑ።");
      } else {
        session.draft = {
          ...session.draft,
          docType,
          extracted: extraction.fields,
          missing: extraction.missing,
        };
        session.history.push({ role: "assistant", content: extraction.question });
        await persist(session);
        await sendMessage(chatId, extraction.question, { reply_markup: CHANGE_CANCEL_KEYBOARD });
      }
      return NextResponse.json({ ok: true });
    }

    /* ── Idle free text ── */
    if (text && user) {
      const caps = capabilitiesFor(user.positions);

      if (caps.some((c) => c.key === "ops") && isOpsReportText(text)) {
        const result = await ingestOpsReport(text, user.fullName);
        await logActivity({
          chatId,
          actor: user.fullName,
          userId: String(user._id),
          positions: user.positions,
          audience: "internal",
          action: "submission",
          detail: "ops",
        });
        await sendMessage(
          chatId,
          `✅ ሪፖርት ተቀምጧል፦ <b>${result.saved}</b> አዲስ ቀን(ናት) ተመዝግቧል፣ <b>${result.updated}</b> ተሻሽሏል።`
        );
        await sendRoleMenu(chatId, user);
        return NextResponse.json({ ok: true });
      }

      const reply = await companyChat([{ role: "user", content: text }]);
      await logActivity({
        chatId,
        actor: user.fullName,
        userId: String(user._id),
        positions: user.positions,
        audience: "internal",
        action: "chat_question",
        detail: text.slice(0, 200),
      });
      await sendMessage(chatId, reply);
      return NextResponse.json({ ok: true });
    }

    if (isExternal) {
      await sendExternalMenu(chatId, MSG.pickReportFirst);
      return NextResponse.json({ ok: true });
    }

    await sendEntryMenu(chatId, MSG.welcome);
  } catch (e) {
    console.error("telegram webhook error:", e);
    await logActivity({
      chatId,
      actor: tgName,
      action: "error",
      ok: false,
      detail: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
    }).catch(() => {});
    await sendMessage(chatId, isMongoAccessError(e) ? MSG.dbError : MSG.genericError).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
