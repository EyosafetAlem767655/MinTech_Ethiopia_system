import { NextRequest, NextResponse } from "next/server";
import sql, { first, isUuid, jsonb } from "@/lib/sql";
import { getFileBytes, putFile } from "@/lib/storage";
import { loadSession, saveSession } from "@/lib/sessions";
import { latestBrief } from "@/lib/brief";
import {
  checkReceiptQRCode,
  classifyIngestion,
  extractReceiptGemini,
  scoreStonePhoto,
  verifyRequestLegitimacy,
  type GeminiReceipt,
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
  sendDocument,
  sendEntryMenu,
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
  isReceiverOnly,
  positionLabelsAm,
  type Capability,
  type CapabilityKey,
  type HrKind,
} from "@/lib/positions";
import { insertClaimPhotos, processClaimPhoto } from "@/lib/claims";
import { ingestOpsReport, isOpsReportText } from "@/lib/ops-report";
import { spreadsheetToText, isSpreadsheetMime } from "@/lib/spreadsheet";
import {
  buildSalesReceiptsWorkbook,
  compareReceipt,
  computeReceipt,
  extractSalesReceipt,
  type ReceiptCheck,
  type SalesReceiptDraft,
  type SalesReceiptRow,
} from "@/lib/receipt-scan";

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

/**
 * Every sendMessage goes out with parse_mode: "HTML", so any interpolated value
 * that did not come from us has to be escaped — an error string containing a
 * stray "<" makes Telegram reject the whole message with "can't parse entities",
 * and the user then sees nothing at all.
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Buttons are matched by their normalised label, so labels stay editable in one place. */
const CAP_BY_LABEL = new Map<string, Capability>(
  Object.values(CAPABILITIES).map((c) => [normaliseChoice(c.button), c])
);
const HR_KIND_BY_LABEL = new Map<string, HrKind>(
  (Object.keys(HR_KINDS) as HrKind[]).map((k) => [normaliseChoice(HR_KINDS[k].button), k])
);

const NORM = {
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
  receiverOnly: "📊 ይህ መለያ ሪፖርት አይልክም። የቀኑን ማጠቃለያ በዚህ ቦት ይቀበላሉ።",
  editPrompt: "✏️ የተስተካከለውን ሪፖርት ይላኩ።",
  editExpired: "⛔ የማስተካከያ ጊዜው (5 ደቂቃ) አልፏል።",
  editUnavailable: "🔍 ይህን ሪፖርት ማስተካከል አልተቻለም።",
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

/* ─────────────────────── Telegram update de-duplication ───────────────────── */

/**
 * Telegram retries an update until the webhook answers 200. A handler killed by
 * the serverless time limit never answers, so the same update comes back, runs
 * the same slow branch, and is killed again — the loop that made the receipt
 * scanner repeat "reading the receipt…" once a minute forever.
 *
 * Claiming the update_id before any work makes the handler idempotent. The
 * insert is the lock: whoever wins it processes the update, and a redelivery
 * (or a concurrent duplicate) loses the race and is acknowledged instead.
 *
 * Fails OPEN — if the claim query itself errors we process the update rather
 * than dropping a real message on the floor.
 */
let _updatesTableEnsured = false;
async function claimUpdate(updateId: number, chatId: string): Promise<boolean> {
  try {
    const rows = await sql<{ update_id: string }[]>`
      insert into telegram_updates (update_id, chat_id)
      values (${updateId}, ${chatId})
      on conflict (update_id) do nothing
      returning update_id`;
    return rows.length > 0;
  } catch (e) {
    // Table missing (42P01) — the deployment is ahead of its migrations. Create
    // it once and retry, matching how the session columns self-heal.
    if ((e as { code?: string })?.code === "42P01" && !_updatesTableEnsured) {
      _updatesTableEnsured = true;
      await sql`
        create table if not exists telegram_updates (
          update_id  bigint primary key,
          chat_id    text,
          created_at timestamptz not null default now()
        )`.catch(() => {});
      await sql`create index if not exists telegram_updates_created_idx on telegram_updates (created_at)`.catch(
        () => {}
      );
      return claimUpdate(updateId, chatId);
    }
    console.error("claimUpdate failed (processing anyway):", e);
    return true;
  }
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
  // Admin/HR are receivers — no submit menu, just a logout key.
  if (isReceiverOnly(user.positions || [])) {
    return sendReportMenu(chatId, [], text || MSG.receiverOnly);
  }
  return sendReportMenu(chatId, menuButtons(user), text);
}

function actorOf(session: any, user?: any): string {
  if (user) return user.fullName;
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

/* ─────────────────────────── 5-minute edit window ─────────────────────────── */

const EDIT_WINDOW_MS = 5 * 60 * 1000;

/** Tables whose most recent row an employee may correct within the window. */
const EDITABLE_TABLES = new Set([
  "daily_reports",
  "material_counts",
  "hr_reports",
  "receipts",
  "purchase_requests",
  "damage_claims",
  "stone_deliveries",
  "shift_reports",
  "invoices",
  "payments",
  "production_reports",
  "stock_status_reports",
  "raw_material_receipts",
  "delivery_reports",
  "purchase_item_reports",
]);

interface SubmissionRef {
  table: string;
  id: string;
}

/** Inline "✏️ Correct" button attached to a submission confirmation. */
function editMarkup(ref?: SubmissionRef) {
  if (!ref) return undefined;
  return {
    inline_keyboard: [[{ text: "✏️ አስተካክል (5 ደቂቃ)", callback_data: `edit:${ref.table}:${ref.id}` }]],
  };
}

async function deleteSubmissionRow(table: string, id: string) {
  if (!EDITABLE_TABLES.has(table) || !isUuid(id)) return;
  // table is whitelisted; sql(identifier) escapes it safely.
  await sql`delete from ${sql(table)} where id = ${id}`;
}

/**
 * Record the just-saved submission as the editable one, and — if this submission
 * is itself the corrected version of a previous one (same type) — delete the old
 * row now (replace-on-arrival, so an abandoned correction never loses data).
 */
async function finalizeSubmission(
  session: any,
  ref: SubmissionRef | undefined,
  capKey: string,
  hrKind?: string
) {
  const pending = session.editState?.pending as SubmissionRef | undefined;
  if (pending && ref && pending.table === ref.table && pending.id !== ref.id) {
    await deleteSubmissionRow(pending.table, pending.id).catch(() => {});
  }
  session.editState = ref ? { table: ref.table, id: ref.id, capKey, hrKind, at: Date.now() } : undefined;
}

/** Handles the "✏️ Correct" inline button: re-opens the report within 5 minutes. */
async function handleEditCallback(data: string, callbackId: string, chatId: string, tgName: string) {
  const [, table, id] = data.split(":");
  const session = await loadSession(chatId, tgName);
  const resolved = await resolveSession(session);
  if (!resolved) {
    await answerCallbackQuery(callbackId, "🔐 እባክዎ ይግቡ።");
    return;
  }

  const es = session.editState;
  if (!es || es.table !== table || es.id !== id || !isUuid(String(id))) {
    await answerCallbackQuery(callbackId, MSG.editUnavailable);
    return;
  }
  if (Date.now() - Number(es.at || 0) > EDIT_WINDOW_MS) {
    await answerCallbackQuery(callbackId, MSG.editExpired);
    return;
  }

  const cap = CAPABILITIES[es.capKey as CapabilityKey];
  if (!cap) {
    await answerCallbackQuery(callbackId, MSG.editUnavailable);
    return;
  }

  // Mark this record for replacement; the corrected submission deletes it on arrival.
  session.editState = { ...es, pending: { table, id } };
  await answerCallbackQuery(callbackId, "✏️ አስተካክል");

  if (cap.captureMode === "capture") {
    await startCapture(session, chatId, cap, es.hrKind as HrKind | undefined);
  } else {
    await startLlmReport(session, chatId, cap);
  }
  await sendMessage(chatId, MSG.editPrompt);
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

/** Parse a report date string; falls back to now on anything unparseable. */
function parseReportDate(v: unknown): Date {
  const d = new Date(String(v ?? ""));
  return isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Self-heal the sales_receipts schema (migrations 0008 + 0009 + 0010). If a
 * deployment is running ahead of its migrations the table/columns are missing and
 * every sales submission fails with undefined_table (42P01) / undefined_column
 * (42703). Creating it idempotently here lets the feature work without a manual
 * migration step, matching how the session columns already self-heal.
 */
let _salesSchemaEnsured = false;
async function ensureSalesReceiptsSchema(): Promise<void> {
  if (_salesSchemaEnsured) return;
  await sql`
    create table if not exists sales_receipts (
      id             uuid primary key default gen_random_uuid(),
      date           timestamptz not null default now(),
      customer_name  text,
      fs_no          text,
      att_no         text,
      product_ty     text,
      qty            numeric(14,3),
      unit_price     numeric(14,2),
      sub_total      numeric(16,2),
      vat            numeric(16,2),
      grand_total    numeric(16,2),
      withhold       numeric(16,2) default 0,
      net_pay        numeric(16,2),
      deposited_bank text,
      status         text not null default 'processed' check (status in ('processed','submitted')),
      reported_by    text not null,
      photo_file_ids uuid[] not null default '{}',
      created_at     timestamptz not null default now(),
      updated_at     timestamptz not null default now()
    )
  `;
  await sql`create index if not exists sales_receipts_created_idx on sales_receipts (created_at desc)`.catch(() => {});
  await sql`alter table sales_receipts add column if not exists remark text`.catch(() => {});
  await sql`alter table sales_receipts add column if not exists receipt_check jsonb`.catch(() => {});
  _salesSchemaEnsured = true;
}

/**
 * Background receipt verification (runs after the report is already saved, so the
 * submitter isn't blocked). Reads the receipt photo with the AI, cross-checks the
 * extracted numbers against the figures the salesperson typed, stores a confidence
 * verdict on the row for the dashboard, and — if the numbers disagree —
 * messages the submitter to correct the data.
 */
async function backgroundReceiptCheck(opts: {
  chatId: string;
  receiptId: string;
  images: string[];
  entered: SalesReceiptDraft;
  guided: boolean;
  /**
   * Verdict already obtained while reading the photo (scan mode). Supplying it
   * skips a second Gemini call: the scan read returns the confidence too, and
   * scan mode has nothing to cross-check — the extracted values ARE what was
   * entered.
   */
  preCheck?: ReceiptCheck | null;
}): Promise<void> {
  try {
    if (opts.preCheck) {
      await saveReceiptCheck(opts.receiptId, opts.preCheck);
      await notifyReceiptProblems(opts.chatId, opts.preCheck);
      return;
    }

    const imgs: { base64: string; contentType: string }[] = [];
    for (const id of opts.images.slice(0, 3)) {
      const b = await getFileBytes(id).catch(() => null);
      if (b) imgs.push({ base64: b.base64, contentType: b.contentType });
    }
    if (imgs.length === 0) return;

    // Gemini reads the receipt (fields + stamp + confidence) in a single call,
    // bounded by RECEIPT_BUDGET_MS so it cannot run the webhook past its limit.
    const read = await extractReceiptGemini(imgs).catch((e) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    const g = read.ok ? read.data : null;
    const extracted = g
      ? {
          ...computeReceipt({
            date: g.date || new Date().toISOString().slice(0, 10),
            customerName: g.customerName,
            productTy: g.productTy,
            qty: g.qty,
            unitPrice: g.unitPrice,
            withhold: g.withhold,
            remark: "",
          }),
          printedGrandTotal: g.grandTotal || undefined,
        }
      : null;
    // Cross-check only makes sense in the guided flow, where the numbers were
    // typed by hand; in scan mode the entered values ARE the extraction.
    const mismatches = opts.guided && extracted ? compareReceipt(opts.entered, extracted) : [];
    const check: ReceiptCheck = {
      checked: read.ok,
      score: g ? g.confidence : 0,
      flags: read.ok ? [] : ["ai_check_failed"],
      reasoning: read.ok ? g!.notes : `Automatic receipt check failed: ${read.error}`,
      extracted: extracted
        ? {
            productTy: extracted.productTy,
            qty: extracted.qty,
            unitPrice: extracted.unitPrice,
            // Report what the receipt actually printed, not our recomputation.
            grandTotal: extracted.printedGrandTotal ?? extracted.grandTotal,
          }
        : null,
      mismatches,
    };

    await saveReceiptCheck(opts.receiptId, check);

    // Fs No, Att.No and Deposited Bank can only come off the receipt, so the
    // guided flow never asks for them — fill them in from what Gemini just read
    // rather than making the salesperson copy numbers by hand.
    if (g) await backfillReceiptOnlyColumns(opts.receiptId, g);

    await notifyReceiptProblems(opts.chatId, check);
  } catch (e) {
    console.error("backgroundReceiptCheck failed:", e);
  }
}

/**
 * Write the receipt-only identity columns onto a saved row, without overwriting
 * anything already there (a scan-mode row, or a value the salesperson edited).
 */
async function backfillReceiptOnlyColumns(receiptId: string, g: GeminiReceipt): Promise<void> {
  if (!g.fsNo && !g.attNo && !g.depositedBank) return;
  try {
    await sql`
      update sales_receipts
         set fs_no          = coalesce(nullif(fs_no, ''), ${g.fsNo || null}),
             att_no         = coalesce(nullif(att_no, ''), ${g.attNo || null}),
             deposited_bank = coalesce(nullif(deposited_bank, ''), ${g.depositedBank || null}),
             updated_at     = now()
       where id = ${receiptId}`;
  } catch (e) {
    console.error("backfillReceiptOnlyColumns failed:", e);
  }
}

/** Persist a verdict onto the row, self-healing the column if the migration lags. */
async function saveReceiptCheck(receiptId: string, check: ReceiptCheck): Promise<void> {
  try {
    await sql`update sales_receipts set receipt_check = ${jsonb(check)}, updated_at = now() where id = ${receiptId}`;
  } catch (e) {
    if ((e as { code?: string })?.code === "42703") {
      await ensureSalesReceiptsSchema();
      await sql`update sales_receipts set receipt_check = ${jsonb(check)} where id = ${receiptId}`.catch(() => {});
    }
  }
}

/** Tell the submitter only about problems the check actually established. */
async function notifyReceiptProblems(chatId: string, check: ReceiptCheck): Promise<void> {
  // A failed check is NOT a failed receipt. Only accuse the submitter of
  // sending an unstamped receipt when the check actually ran; otherwise say
  // plainly that verification did not complete and leave it for manual review.
  if (!check.checked) {
    await sendMessage(chatId, "⚠️ የደረሰኙ ማጣራት አሁን አልተሳካም። ሪፖርቱ ተቀምጧል፤ ደረሰኙ በእጅ ይጣራል።").catch(() => {});
    return;
  }

  const problems: string[] = [];
  if (check.mismatches.length > 0) {
    problems.push("⚠️ ያስገቡት መረጃ ከደረሰኙ ጋር አይመሳሰልም፦\n" + check.mismatches.map((m) => `• ${m}`).join("\n"));
  }
  if (problems.length > 0) {
    await sendMessage(
      chatId,
      `🔎 <b>የደረሰኝ ማጣራት ውጤት</b> · Confidence ${check.score}%\n\n${problems.join("\n\n")}\n\nእባክዎ ትክክለኛውን መረጃ አስተካክለው በድጋሚ ያስገቡ።`
    ).catch(() => {});
  }
}

/** Fold an LLM `items` array (e.g. [{product,tons}]) into a { key: number } jsonb map. */
function itemsToMap(items: unknown, keyField: string, valField: string): Record<string, number> {
  const map: Record<string, number> = {};
  if (Array.isArray(items)) {
    for (const it of items) {
      const rec = it as Record<string, unknown>;
      const k = String(rec?.[keyField] ?? "").trim();
      const v = Number(rec?.[valField]);
      if (k && !isNaN(v)) map[k] = v;
    }
  }
  return map;
}

async function saveExtractedRecord(
  extraction: IngestionExtraction,
  opts: { fileId?: string; userName: string; meta?: Record<string, unknown> }
): Promise<{ reply: string; ref?: SubmissionRef }> {
  const f = extraction.fields as Record<string, any>;

  switch (extraction.docType) {
    case "receipt": {
      if (!opts.fileId) {
        return { reply: "📷 ደረሰኝ ፎቶ ያስፈልጋል። QR ኮድ ያለው ኦፊሴላዊ ደረሰኝ ፎቶ ይላኩ።" };
      }

      const photo = await getPhotoBase64(opts.fileId);
      if (!photo) {
        return { reply: "📷 ፎቶ አልተገኘም። እባክዎ ድጋሚ ይሞክሩ።" };
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
        return { reply: "❌ ፎቶው ላይ QR ኮድ አልተገኘም። እባክዎ QR ኮድ ያለው ኦፊሴላዊ ደረሰኝ ፎቶ ይላኩ።" };
      }

      const vendor = String(f.vendor || "Unknown vendor");
      const amount = Number(f.amount) || 0;
      const [row] = await sql<{ id: string }[]>`
        insert into receipts (vendor, client, amount, category, receipt_date, tax_invoice_number,
                              photo_file_id, submitted_by, source, legitimacy, meta)
        values (${vendor}, ${f.client ? String(f.client) : null}, ${amount},
                ${f.category ? String(f.category) : null},
                ${f.receiptDate ? new Date(String(f.receiptDate)) : new Date()},
                ${f.taxInvoiceNumber ? String(f.taxInvoiceNumber) : null},
                ${opts.fileId || null}, ${opts.userName}, 'telegram',
                ${legitimacy ? sql.json(legitimacy as any) : null},
                ${sql.json({ ...f, ...(opts.meta || {}) })})
        returning id
      `;
      const legitimacyNote = legitimacy ? ` · ተዓማኒነት፦ ${legitimacy.score}%` : "";
      return {
        reply: `🧾 ደረሰኝ ተቀምጧል፦ <b>${vendor}</b> — ${amount.toLocaleString()} ETB${legitimacyNote}`,
        ref: { table: "receipts", id: row.id },
      };
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
      return {
        reply: `🛒 የግዢ ጥያቄ ተቀምጧል፦ <b>${prTitle}</b> — ${prAmount.toLocaleString()} ETB${legitimacyNote} · ለባለቤቱ ማሳወቂያ ተልኳል።`,
        ref: { table: "purchase_requests", id: pr.id },
      };
    }

    case "damage_claim": {
      if (!opts.fileId) return { reply: "📷 ፎቶ ያስፈልጋል። እባክዎ የተበላሹትን ከረጢቶች ፎቶ ከብዛቱ ጋር አብረው ይላኩ።" };

      const reportedCount = Number(f.quantity) || 0;
      if (!reportedCount) return { reply: "📝 የተበላሹትን ከረጢቶች ብዛት ያካትቱ።" };

      const file = await getFileBytes(opts.fileId);
      if (!file) return { reply: "❌ ፎቶው አልተገኘም። እባክዎ ድጋሚ ይላኩ።" };

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
      return {
        reply:
          `🛡️ የ${reportedCount} ከረጢቶች ብልሽት ሪፖርት ተቀምጧል${aiNote}።\n` +
          `🔍 የ-AI እምነት ደረጃ፦ <b>${processed.trustScore}%</b> (${trustLevel})` +
          mismatchNote +
          `\n\nየተቆጣጣሪ ፊርማ ያስፈልጋል።`,
        ref: { table: "damage_claims", id: claim.id },
      };
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
      const [row] = await sql<{ id: string }[]>`
        insert into stone_deliveries (truck_plate, supplier, quarry, driver_name, gate_clerk, loads, quality_grade, photo_file_id, ai_score, notes)
        values (${truckPlate}, ${f.supplier ? String(f.supplier) : null}, ${f.quarry ? String(f.quarry) : null},
                ${f.driverName ? String(f.driverName) : null}, ${opts.userName}, ${loads}, ${qualityGrade},
                ${opts.fileId || null}, ${aiScore ? sql.json(aiScore as any) : null},
                ${f.notes ? String(f.notes) : aiScore?.recommendation ?? null})
        returning id
      `;
      return {
        reply: `🚚 የጭነት መኪና ማድረሻ ተቀምጧል፦ <b>${truckPlate}</b>፣ ${loads} ጭነት(ቶች)፣ ጥራት፦ ${qualityGrade}።`,
        ref: { table: "stone_deliveries", id: row.id },
      };
    }

    case "shift_report": {
      const bagWeightKg = [25, 40].includes(Number(f.bagWeightKg)) ? Number(f.bagWeightKg) : null;
      const filledSacks = Number(f.filledSacks) || 0;
      const [row] = await sql<{ id: string }[]>`
        insert into shift_reports (supervisor, filled_sacks, bag_weight_kg, downtime_minutes, shift, notes)
        values (${opts.userName}, ${filledSacks}, ${bagWeightKg}, ${Number(f.downtimeMinutes) || 0},
                ${f.shift === "night" ? "night" : "day"}, ${f.notes ? String(f.notes) : null})
        returning id
      `;
      const tons = bagWeightKg ? ((filledSacks * bagWeightKg) / 1000).toFixed(2) : null;
      const tonsStr = tons ? ` (${tons} ቶን)` : "";
      return {
        reply: `🏭 የፈረቃ ሪፖርት ተቀምጧል፦ ${filledSacks} ከረጢቶች${tonsStr}፣ ${Number(f.downtimeMinutes) || 0} ደቂቃ የሥራ መቋረጥ።`,
        ref: { table: "shift_reports", id: row.id },
      };
    }

    case "invoice": {
      const bagWeightKg = [25, 40].includes(Number(f.bagWeightKg)) ? Number(f.bagWeightKg) : null;
      const invoiceNumber = String(f.invoiceNumber || `TG-${Date.now()}`);
      const client = String(f.client || "Unknown client");
      const amount = Number(f.amount) || 0;
      const [row] = await sql<{ id: string }[]>`
        insert into invoices (invoice_number, client, client_phone, sacks, bag_weight_kg, amount, invoiced_at, due_date, withholding_receipt_received, notes)
        values (${invoiceNumber}, ${client}, ${f.clientPhone ? String(f.clientPhone) : null},
                ${Number(f.sacks) || 0}, ${bagWeightKg}, ${amount},
                ${f.invoiceDate ? new Date(String(f.invoiceDate)) : new Date()},
                ${f.dueDate ? new Date(String(f.dueDate)) : new Date(Date.now() + 30 * 86400000)},
                false, ${f.notes ? String(f.notes) : null})
        returning id
      `;
      return {
        reply: `💵 የሽያጭ ደረሰኝ ተቀምጧል፦ <b>${invoiceNumber}</b> — ${client} — ${amount.toLocaleString()} ETB።`,
        ref: { table: "invoices", id: row.id },
      };
    }

    case "payment": {
      const invoiceNumber = String(f.invoiceNumber || "").trim();
      if (!invoiceNumber) return { reply: "🔢 ለዚህ ክፍያ የደረሰኝ ቁጥሩን (invoice number) ያካትቱ።" };

      const invoice = await findInvoiceByNumber(invoiceNumber);
      if (!invoice)
        return {
          reply: `🔍 የደረሰኝ ቁጥር <b>${invoiceNumber}</b> አልተገኘም። እባክዎ መጀመሪያ የሽያጭ ደረሰኙን ይላኩ፣ ወይም ቁጥሩን ያስተካክሉ።`,
        };

      const amount = Number(f.amount) || 0;
      const [row] = await sql<{ id: string }[]>`
        insert into payments (invoice_id, amount, date, method)
        values (${invoice.id}, ${amount},
                ${f.paymentDate ? new Date(String(f.paymentDate)) : new Date()},
                ${f.method ? String(f.method) : "telegram"})
        returning id
      `;
      return {
        reply: `💵 የክፍያ መረጃ ለ<b>${invoiceNumber}</b> ተቀምጧል፦ ${amount.toLocaleString()} ETB።`,
        ref: { table: "payments", id: row.id },
      };
    }

    case "withholding_receipt": {
      const invoiceNumber = String(f.invoiceNumber || "").trim();
      if (!invoiceNumber) return { reply: "🔢 የደረሰኝ ቁጥሩን (invoice number) ያካትቱ።" };

      const invoice = await findInvoiceByNumber(invoiceNumber);
      if (!invoice) return { reply: `🔍 የደረሰኝ ቁጥር <b>${invoiceNumber}</b> አልተገኘም። እባክዎ ትክክለኛውን ቁጥር ይላኩ።` };

      await sql`
        update invoices set
          withholding_receipt_received = true,
          withholding_receipt_received_at = ${f.receiptDate ? new Date(String(f.receiptDate)) : new Date()},
          withholding_receipt_file_id = ${opts.fileId || null}
        where id = ${invoice.id}
      `;
      return { reply: `📄 የታክስ ደረሰኝ ለ<b>${invoiceNumber}</b> (${invoice.client}) ተቀምጧል።` };
    }

    /* ─────────────── Department report formats (text / photo / Excel) ─────────────── */

    case "production_report": {
      const products = itemsToMap(f.items, "product", "tons");
      const fgrNo = f.fgrNo ? String(f.fgrNo) : null;
      const [row] = await sql<{ id: string }[]>`
        insert into production_reports (date, fgr_no, reported_by, products, source)
        values (${parseReportDate(f.date)}, ${fgrNo}, ${opts.userName}, ${sql.json(products)}, 'telegram')
        returning id
      `;
      const total = Object.values(products).reduce((a, b) => a + b, 0);
      return {
        reply: `🏭 የምርት ሪፖርት ተቀምጧል${fgrNo ? ` · FGR ${fgrNo}` : ""} · ${Object.keys(products).length} ምርት · ${total.toFixed(2)} ቶን።`,
        ref: { table: "production_reports", id: row.id },
      };
    }

    case "stock_status": {
      const items = Array.isArray(f.rows) ? f.rows : [];
      const month = String(f.month || new Date().toISOString().slice(0, 7));
      const [row] = await sql<{ id: string }[]>`
        insert into stock_status_reports (month, reported_by, items, source)
        values (${month}, ${opts.userName}, ${sql.json(items)}, 'telegram')
        returning id
      `;
      return {
        reply: `📦 የክምችት ሁኔታ ሪፖርት (${month}) ተቀምጧል · ${items.length} ምርት።`,
        ref: { table: "stock_status_reports", id: row.id },
      };
    }

    case "raw_material_received": {
      const materials = itemsToMap(f.items, "material", "qty");
      const [row] = await sql<{ id: string }[]>`
        insert into raw_material_receipts (date, supplier, dn_no, truck_plate, mrv_no, reported_by, materials, source)
        values (${parseReportDate(f.date)}, ${f.supplier ? String(f.supplier) : null},
                ${f.dnNo ? String(f.dnNo) : null}, ${f.truckPlate ? String(f.truckPlate) : null},
                ${f.mrvNo ? String(f.mrvNo) : null}, ${opts.userName}, ${sql.json(materials)}, 'telegram')
        returning id
      `;
      const total = Object.values(materials).reduce((a, b) => a + b, 0);
      return {
        reply: `🚚 የጥሬ ዕቃ ገቢ ተቀምጧል${f.supplier ? ` · ${String(f.supplier)}` : ""} · ${total.toFixed(2)} ብዛት።`,
        ref: { table: "raw_material_receipts", id: row.id },
      };
    }

    case "finished_goods_delivery": {
      const products = itemsToMap(f.items, "product", "qty");
      const paymentType = f.paymentType === "credit" ? "credit" : f.paymentType === "cash" ? "cash" : null;
      const qty = Number(f.qty) || Object.values(products).reduce((a, b) => a + b, 0);
      const customer = String(f.customer || "Unknown customer");
      const [row] = await sql<{ id: string }[]>`
        insert into delivery_reports (date, customer, invoice_no, payment_type, qty, delivery_no, reported_by, products, source)
        values (${parseReportDate(f.date)}, ${customer}, ${f.invoiceNo ? String(f.invoiceNo) : null},
                ${paymentType}, ${qty}, ${f.deliveryNo ? String(f.deliveryNo) : null},
                ${opts.userName}, ${sql.json(products)}, 'telegram')
        returning id
      `;
      return {
        reply: `🚛 የሽያጭ ማድረሻ ተቀምጧል፦ <b>${customer}</b>${paymentType ? ` · ${paymentType}` : ""} · ${qty} ብዛት።`,
        ref: { table: "delivery_reports", id: row.id },
      };
    }

    case "purchase_items": {
      const description = String(f.description || f.title || "Purchase item");
      const amount = f.amount != null ? Number(f.amount) : null;
      const [row] = await sql<{ id: string }[]>`
        insert into purchase_item_reports (date, description, uom, qty, supplier, amount, cost_center, purchaser, reported_by, source)
        values (${parseReportDate(f.date)}, ${description}, ${f.uom ? String(f.uom) : null},
                ${f.qty != null ? Number(f.qty) : null}, ${f.supplier ? String(f.supplier) : null},
                ${amount}, ${f.costCenter ? String(f.costCenter) : null},
                ${f.purchaser ? String(f.purchaser) : opts.userName}, ${opts.userName}, 'telegram')
        returning id
      `;
      return {
        reply: `🧾 የግዢ ዕቃ ተቀምጧል፦ <b>${description}</b>${amount ? ` · ${Math.round(amount).toLocaleString()} ETB` : ""}።`,
        ref: { table: "purchase_item_reports", id: row.id },
      };
    }

    default:
      return { reply: "✅ ደርሷል። ከማውጫው (menu) ውስጥ የሪፖርት ዓይነት ይምረጡ።" };
  }
}

/** Writes the free-text capture types: daily report, material count, HR report. */
async function saveCapture(session: any, user: any): Promise<{ reply: string; ref?: SubmissionRef }> {
  const capture = session.capture || {};
  const photoFileIds = (capture.photoFileIds || []) as string[];
  const text = String(capture.text || "").trim();

  if (capture.capKey === "daily_report") {
    const [row] = await sql<{ id: string }[]>`
      insert into daily_reports (user_id, full_name, positions, date_key, text, photo_file_ids, source)
      values (${user._id}, ${user.fullName}, ${user.positions}, ${eatDateKey()}, ${text}, ${photoFileIds}, 'telegram')
      returning id
    `;
    const photoNote = photoFileIds.length ? ` · ${photoFileIds.length} ፎቶ(ዎች)` : "";
    return { reply: `✅ የቀኑ ሪፖርት ተቀምጧል${photoNote}። አመሰግናለሁ!`, ref: { table: "daily_reports", id: row.id } };
  }

  if (capture.capKey === "materials") {
    const [row] = await sql<{ id: string }[]>`
      insert into material_counts (user_id, counted_by, date_key, raw_text, photo_file_ids)
      values (${user._id}, ${user.fullName}, ${eatDateKey()}, ${text}, ${photoFileIds})
      returning id
    `;
    return { reply: `📦 የዕቃ ቆጠራ ተቀምጧል። አመሰግናለሁ!`, ref: { table: "material_counts", id: row.id } };
  }

  if (capture.capKey === "hr") {
    const kind = (capture.hrKind || "customer_contact") as HrKind;
    const [row] = await sql<{ id: string }[]>`
      insert into hr_reports (user_id, full_name, kind, text, photo_file_ids)
      values (${user._id}, ${user.fullName}, ${kind}, ${text}, ${photoFileIds})
      returning id
    `;
    return { reply: `👥 ሪፖርት ተቀምጧል፦ <b>${HR_KINDS[kind].button}</b>።`, ref: { table: "hr_reports", id: row.id } };
  }

  return { reply: "✅ ደርሷል።" };
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
    capKey: cap.key,
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

/* ───────────────────────── Sales receipt-scan flow ───────────────────────── */

/**
 * Atomically append one stored-file id to receipt_scan.images and return the
 * resulting list.
 *
 * Doing this in SQL rather than in JS is what makes a media group work: the
 * photos arrive as concurrent updates, so a read-modify-write of the whole
 * session object has every instance overwriting the others' additions.
 */
async function appendReceiptImage(chatId: string, fileId: string): Promise<string[]> {
  const rows = await sql<{ images: string[] | null }[]>`
    update telegram_sessions
       set receipt_scan = jsonb_set(
             coalesce(receipt_scan, '{}'::jsonb),
             '{images}',
             coalesce(receipt_scan -> 'images', '[]'::jsonb) || ${jsonb([fileId])}
           )
     where chat_id = ${chatId}
   returning receipt_scan -> 'images' as images`;
  const images = rows[0]?.images;
  return Array.isArray(images) ? images.map(String) : [fileId];
}

const RECEIPT_BTN = {
  done: "✅ ጨርሻለሁ",
  approve: "✅ አጽድቅ",
  edit: "✏️ አስተካክል",
  export: "📊 የዛሬውን Excel",
  submit: "📤 ወደ ዳሽቦርድ አስገባ",
  again: "🧾 አዲስ ደረሰኝ",
} as const;

const NORM_RECEIPT = {
  done: normaliseChoice(RECEIPT_BTN.done),
  approve: normaliseChoice(RECEIPT_BTN.approve),
  edit: normaliseChoice(RECEIPT_BTN.edit),
  export: normaliseChoice(RECEIPT_BTN.export),
  submit: normaliseChoice(RECEIPT_BTN.submit),
  again: normaliseChoice(RECEIPT_BTN.again),
};

const receiptCollectKeyboard = {
  keyboard: [[{ text: RECEIPT_BTN.done }], [{ text: NAV_BUTTONS.cancel }]],
  resize_keyboard: true,
  one_time_keyboard: false,
};
const receiptActionKeyboard = {
  keyboard: [[{ text: RECEIPT_BTN.approve }], [{ text: RECEIPT_BTN.edit }], [{ text: NAV_BUTTONS.cancel }]],
  resize_keyboard: true,
  one_time_keyboard: false,
};
// No "submit to dashboard" button: approving a report now publishes it straight
// to the web app, so a second manual step would only be a way to forget.
const receiptNextKeyboard = {
  keyboard: [[{ text: RECEIPT_BTN.export }], [{ text: RECEIPT_BTN.again }], [{ text: NAV_BUTTONS.back }]],
  resize_keyboard: true,
  one_time_keyboard: false,
};

const money = (n: number) => Math.round(Number(n) || 0).toLocaleString();

/* Guided sales-report entry: ask one field at a time, then attach receipts. */
const salesEntryKeyboard = {
  keyboard: [[{ text: NAV_BUTTONS.cancel }]],
  resize_keyboard: true,
  one_time_keyboard: false,
};
type SalesStep = "date" | "customer" | "product_qty" | "unit_price" | "withholding" | "remark";
const SALES_STEP_PROMPT: Record<SalesStep, string> = {
  date: '📅 የሽያጩን ቀን ይፃፉ (ለምሳሌ 2018-06-01) ወይም ለዛሬ "ዛሬ" ይበሉ።',
  customer: "👤 የደንበኛውን ስም ይፃፉ።",
  product_qty: '📦 ምርት እና ብዛት ይፃፉ (ለምሳሌ፦ ETL-9 / 120)።',
  unit_price: "💲 የአንዱን ዋጋ (Unit Price, ETB) ይፃፉ።",
  withholding: '➖ ዊዝሆልዲንግ (Withholding, ETB) ይፃፉ። ከሌለ "የለም" ይፃፉ።',
  remark: '📝 ማስታወሻ (Remark) ካለ ይፃፉ። ከሌለ "None" ይፃፉ።',
};
const isToday = (t: string) => ["ዛሬ", "today", "-"].includes(t.trim().toLowerCase());
const PHOTOS_PROMPT = '📷 የደረሰኙን ፎቶ(ዎች) ያያይዙ (እስከ 3) — ለማረጋገጫ። ከጨረሱ "✅ ጨርሻለሁ" ይጫኑ።';

/**
 * How long the receipt_reading state stays believable. A read is budgeted at
 * RECEIPT_BUDGET_MS; anything older than this means the invocation that started
 * it was killed, so the state is stale and the chat must be recovered.
 */
const READING_STALE_MS = 90_000;

const isNone = (t: string) => ["የለም", "none", "no", "0", "-"].includes(t.trim().toLowerCase());
const isSkip = (t: string) => ["ዝለል", "skip", "-"].includes(t.trim().toLowerCase());

/** Parse "ETL-9 / 120" (or "ETL-9 120") into product + trailing quantity. */
function parseProductQty(text: string): { product: string; qty: number } {
  const m = text.match(/(-?\d+(?:\.\d+)?)\s*$/);
  const qty = m ? Number(m[1]) : 0;
  let product = m ? text.slice(0, m.index).trim() : text.trim();
  product = product.replace(/[/,;:\-\s]+$/, "").trim();
  return { product, qty };
}

/** Short receipt-verdict line for the preview: legibility score + cross-check. */
function checkLine(c?: ReceiptCheck | null): string {
  if (!c) return "";
  // "Could not check" is its own outcome — never presented as a problem with
  // the receipt, only as a check that did not run.
  if (!c.checked) return "⏳ ማጣራት አልተሳካም — በእጅ ይጣራል\n";

  const label = c.score >= 75 ? "ግልጽ" : c.score >= 50 ? "ማጣራት ይፈልጋል" : "አጠራጣሪ";
  const icon = c.score >= 75 ? "🔒" : c.score >= 50 ? "🔎" : "⚠️";
  let line = `${icon} ንባብ ${c.score}% · ${label}\n`;
  if (c.mismatches.length > 0) line += `⚠️ ልዩነት: ${c.mismatches.join("; ")}\n`;
  return line;
}

/** The full report row, in the report's own column order, so what the salesperson
 *  approves is exactly what lands in the Excel file. */
function receiptPreview(d: SalesReceiptDraft, check?: ReceiptCheck | null): string {
  return (
    `🧾 <b>የሽያጭ ሪፖርት</b>\n` +
    `📅 Date: ${d.date}\n` +
    `👤 Customers Name: ${escapeHtml(d.customerName || "—")}\n` +
    `🔖 Fs No: ${escapeHtml(d.fsNo || "—")}\n` +
    `🔖 Att.No: ${escapeHtml(d.attNo || "—")}\n` +
    `📦 Product Ty: ${escapeHtml(d.productTy || "—")}\n` +
    `🔢 Qty: ${d.qty || 0}\n` +
    `💲 Unit Price: ${money(d.unitPrice)}\n` +
    `➖ Sub Total: ${money(d.subTotal)}\n` +
    `➕ Vat 15%: ${money(d.vat)}\n` +
    `💰 Grand Total: ${money(d.grandTotal)}\n` +
    `📉 Withhold: ${money(d.withhold)}\n` +
    `✅ Net Pay: ${money(d.netPay)}\n` +
    `🏦 Deposited Bank: ${escapeHtml(d.depositedBank || "—")}\n` +
    `📝 Remark: ${escapeHtml(d.remark || "—")}\n` +
    checkLine(check) +
    `\nትክክል ከሆነ "${RECEIPT_BTN.approve}"፣ ካልሆነ "${RECEIPT_BTN.edit}" ይጫኑ።`
  );
}

/** Applies "field: value" edit lines onto a draft, then recomputes totals. */
function applyReceiptEdits(draft: SalesReceiptDraft, text: string): SalesReceiptDraft {
  const next = { ...draft };
  const num = (v: string) => Number(v.replace(/[^0-9.\-]/g, "")) || 0;
  for (const line of text.split(/\n+/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase().replace(/[.\s_-]/g, "");
    const val = line.slice(idx + 1).trim();
    if (!val) continue;
    if (["date", "ቀን"].includes(key)) next.date = val;
    else if (["customer", "customername", "ደንበኛ"].includes(key)) next.customerName = val;
    else if (["fsno", "fs", "ፍስ"].includes(key)) next.fsNo = val;
    else if (["attno", "att", "አትኖ"].includes(key)) next.attNo = val;
    else if (["product", "productty", "ምርት"].includes(key)) next.productTy = val;
    else if (["qty", "quantity", "ብዛት"].includes(key)) next.qty = num(val);
    else if (["unitprice", "price", "ዋጋ"].includes(key)) next.unitPrice = num(val);
    else if (["withhold", "withholding"].includes(key)) next.withhold = num(val);
    else if (["depositedbank", "bank", "ባንክ"].includes(key)) next.depositedBank = val;
    else if (["remark", "note", "ማስታወሻ"].includes(key)) next.remark = val;
  }
  return computeReceipt(next);
}

/** Start of today in EAT as a Date, for "today's receipts" queries. */
function eatDayStartDate(): Date {
  return new Date(`${eatDateKey()}T00:00:00+03:00`);
}

async function todaysSalesReceipts(reportedBy: string): Promise<SalesReceiptRow[]> {
  const rows = await sql`
    select date, customer_name as "customerName", fs_no as "fsNo", att_no as "attNo",
           product_ty as "productTy", qty, unit_price as "unitPrice", sub_total as "subTotal",
           vat, grand_total as "grandTotal", withhold, net_pay as "netPay",
           deposited_bank as "depositedBank", remark
      from sales_receipts
     where reported_by = ${reportedBy} and created_at >= ${eatDayStartDate()}
     order by created_at asc`;
  return rows as unknown as SalesReceiptRow[];
}

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

  /* ── Idempotency: never run the same update twice ──
     A redelivery (Telegram retrying after a timeout) is acknowledged and
     dropped here, before it can re-enter a slow branch and be killed again. */
  const updateId = Number(update?.update_id);
  if (Number.isFinite(updateId)) {
    const dedupeChatId = String(
      update?.message?.chat?.id || update?.callback_query?.message?.chat?.id || update?.callback_query?.from?.id || ""
    );
    if (!(await claimUpdate(updateId, dedupeChatId))) {
      console.warn(`telegram update ${updateId} already handled — skipping redelivery`);
      return NextResponse.json({ ok: true, deduped: true });
    }
  }

  /* ── Inline-button callbacks (purchase decisions, owner only) ── */
  const cb = update?.callback_query;
  if (cb?.id && cb?.data) {
    const chatId = String(cb.message?.chat?.id || cb.from?.id);
    const userName =
      [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(" ") || cb.from?.username || "Telegram user";
    const data = String(cb.data);

    // Employee "✏️ Correct" button — allowed from the submitter's own chat.
    if (data.startsWith("edit:")) {
      try {
        await handleEditCallback(data, String(cb.id), chatId, userName);
      } catch (e) {
        console.error("telegram edit callback error:", e);
        await answerCallbackQuery(String(cb.id), MSG.genericError);
      }
      return NextResponse.json({ ok: true });
    }

    const ceoChatId = (process.env.TELEGRAM_CEO_CHAT_ID || "").trim();

    // Purchase approvals are irreversible spend decisions; only the owner's chat may make them.
    if (ceoChatId && chatId !== ceoChatId) {
      await answerCallbackQuery(String(cb.id), "⛔ ፈቃድ የለዎትም።");
      await logActivity({ chatId, actor: userName, action: "unauthorized", detail: `callback ${data}`, ok: false }).catch(() => {});
      return NextResponse.json({ ok: true });
    }

    try {
      if (data.startsWith("pr:")) {
        await handlePurchaseCallback(data, String(cb.id), chatId, userName);
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
      const welcomeTail = isReceiverOnly(user.positions)
        ? `\n\n📊 የቀኑን ማጠቃለያ በዚህ ቦት ይቀበላሉ።`
        : `\n\n➡️ የሪፖርት ዓይነት ይምረጡ።`;
      await sendRoleMenu(
        chatId,
        user,
        `✅ እንኳን ደህና መጡ <b>${user.fullName}</b>።\n🏷️ የሥራ መደብ፦ ${positionLabelsAm(user.positions) || "—"}${welcomeTail}`
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
        // Internal-only bot: an unauthenticated /start goes straight to login.
        if (session.auth) clearAuth(session);
        session.state = "awaiting_login_name";
        session.mode = "unknown";
        session.draft = undefined;
        session.capture = undefined;
        session.receiptScan = undefined;
        session.history = [];
        await persist(session);
        await sendMessage(chatId, `🔐 <b>ለውስጥ ሰራተኛ ብቻ</b>\n\n${MSG.askLoginName}`, { reply_markup: BACK_KEYBOARD });
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
      session.receiptScan = undefined;
      session.history = [];
      // Abandoning a correction must not delete the original submission.
      if (session.editState?.pending) session.editState = { ...session.editState, pending: undefined };
      await persist(session);

      const user = await currentUser(session, chatId);
      if (user) await sendRoleMenu(chatId, user, `${MSG.cancelled} እባክዎ የሪፖርት ዓይነት ይምረጡ።`);
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

    /* ── Login door ── */
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

    /* ── Back button at an idle menu ── */
    if (normText === NORM.back && session.state === "idle") {
      session.mode = session.auth ? session.mode : "unknown";
      await persist(session);
      const user = await currentUser(session, chatId);
      if (user) await sendRoleMenu(chatId, user);
      else await sendEntryMenu(chatId, MSG.welcome);
      return NextResponse.json({ ok: true });
    }

    /* ── Everything below needs a signed-in employee ── */
    const user = await currentUser(session, chatId);
    if (!user) {
      await sendEntryMenu(chatId);
      return NextResponse.json({ ok: true });
    }

    const submitterName = user.fullName;

    /* ── Guided sales report: one field at a time, then attach receipts ── */
    if (session.state === "sales_entry" && session.receiptScan?.mode === "guided") {
      const rs = session.receiptScan as { mode: string; step: SalesStep; images: string[]; draft: Partial<SalesReceiptDraft> };
      rs.draft = rs.draft || {};
      const step = rs.step;
      const val = text.trim();
      if (!val) {
        await sendMessage(chatId, SALES_STEP_PROMPT[step], { reply_markup: salesEntryKeyboard });
        return NextResponse.json({ ok: true });
      }

      if (step === "date") {
        rs.draft.date = isToday(val) ? new Date().toISOString().slice(0, 10) : val;
        rs.step = "customer";
      } else if (step === "customer") {
        rs.draft.customerName = val;
        rs.step = "product_qty";
      } else if (step === "product_qty") {
        const { product, qty } = parseProductQty(val);
        if (!product || qty <= 0) {
          await sendMessage(chatId, '⚠️ ምርቱን እና ብዛቱን በትክክል ይፃፉ (ለምሳሌ፦ ETL-9 / 120)።', { reply_markup: salesEntryKeyboard });
          return NextResponse.json({ ok: true });
        }
        rs.draft.productTy = product;
        rs.draft.qty = qty;
        rs.step = "unit_price";
      } else if (step === "unit_price") {
        const price = Number(val.replace(/[^0-9.\-]/g, ""));
        if (!price || price <= 0) {
          await sendMessage(chatId, "⚠️ የአንዱን ዋጋ በቁጥር ይፃፉ።", { reply_markup: salesEntryKeyboard });
          return NextResponse.json({ ok: true });
        }
        rs.draft.unitPrice = price;
        rs.step = "withholding";
      } else if (step === "withholding") {
        rs.draft.withhold = isNone(val) ? 0 : Number(val.replace(/[^0-9.\-]/g, "")) || 0;
        rs.step = "remark";
      } else if (step === "remark") {
        rs.draft.remark = isSkip(val) || isNone(val) ? "" : val;
        // All fields captured → move to receipt attachment.
        session.receiptScan = rs;
        session.state = "receipt_collect";
        await persist(session);
        await sendMessage(chatId, PHOTOS_PROMPT, { reply_markup: receiptCollectKeyboard });
        return NextResponse.json({ ok: true });
      }

      session.receiptScan = rs;
      await persist(session);
      await sendMessage(chatId, SALES_STEP_PROMPT[rs.step], { reply_markup: salesEntryKeyboard });
      return NextResponse.json({ ok: true });
    }

    /* ── Attach receipt photo(s), then finalise (guided compute or scan extract) ── */
    if (session.state === "receipt_collect" && session.receiptScan) {
      const rs = session.receiptScan as {
        mode?: string;
        step?: SalesStep;
        images: string[];
        draft?: Partial<SalesReceiptDraft>;
        check?: ReceiptCheck | null;
        readingSince?: number;
      };
      rs.images = rs.images || [];
      // Matches the approve branch's test exactly. These used to disagree
      // (`=== "guided"` here, `!== "scan"` there), so a session with no mode
      // counted as scan in one place and guided in the other.
      const guided = rs.mode !== "scan";

      if (hasPhoto(msg)) {
        if (rs.images.length >= 3) {
          await sendMessage(chatId, `⚠️ ከ3 ፎቶ በላይ አይፈቀድም። "${RECEIPT_BTN.done}" ይጫኑ።`, { reply_markup: receiptCollectKeyboard });
          return NextResponse.json({ ok: true });
        }
        let stored: { id: string } | null = null;
        try {
          stored = await storeIncomingPhoto(msg);
        } catch (e) {
          // Storage-side failure (Supabase upload / metadata insert). Surface the
          // real reason so it's diagnosable instead of a vague "download failed".
          const detail = e instanceof Error ? e.message.slice(0, 300) : String(e);
          console.error("storeIncomingPhoto (receipt) failed:", e);
          await sendMessage(chatId, `⚠️ ፎቶ ማስቀመጥ አልተቻለም (storage)፦\n${detail}`, { reply_markup: receiptCollectKeyboard });
          return NextResponse.json({ ok: true });
        }
        if (!stored) {
          // Telegram-side: getFile/download returned nothing (token, file size, or
          // the message carried no downloadable photo/document).
          await sendMessage(chatId, "⚠️ ፎቶውን ከቴሌግራም ማውረድ አልተቻለም። እባክዎ ምስሉን እንደ ፎቶ (እንደ ፋይል ሳይሆን) ይላኩ።", {
            reply_markup: receiptCollectKeyboard,
          });
          return NextResponse.json({ ok: true });
        }
        // Append in SQL, not by writing the whole session object back. Selecting
        // several photos at once sends them as separate updates that land on
        // separate serverless instances; each had loaded the same session and
        // wrote back an images array of length 1, so all but the last photo were
        // silently lost and the counter stuck at "1/3".
        rs.images = await appendReceiptImage(chatId, stored.id);
        session.receiptScan = { ...rs };
        if (rs.images.length < 3) {
          await sendMessage(chatId, `📷 ${rs.images.length}/3 ተጨምሯል። ተጨማሪ ይላኩ ወይም "${RECEIPT_BTN.done}" ይጫኑ።`, {
            reply_markup: receiptCollectKeyboard,
          });
          return NextResponse.json({ ok: true });
        }
        // 3 photos reached → fall through to finalise
      } else if (normText !== NORM_RECEIPT.done) {
        await sendMessage(chatId, guided ? PHOTOS_PROMPT : `📷 የደረሰኙን ፎቶ ይላኩ (እስከ 3)፣ ከዚያ "${RECEIPT_BTN.done}"።`, {
          reply_markup: receiptCollectKeyboard,
        });
        return NextResponse.json({ ok: true });
      }

      // A receipt is MANDATORY — a sales report cannot be filed without one.
      if (rs.images.length === 0) {
        await sendMessage(chatId, "📷 ደረሰኝ ማያያዝ ግዴታ ነው። ቢያንስ አንድ የደረሰኝ ፎቶ ይላኩ፣ ከዚያ \"" + RECEIPT_BTN.done + "\" ይጫኑ።", {
          reply_markup: receiptCollectKeyboard,
        });
        return NextResponse.json({ ok: true });
      }

      let draft: SalesReceiptDraft;
      // Scan mode gets its verdict free with the extraction — the same Gemini
      // call returns the confidence. Guided mode has nothing read yet, so its
      // check runs after approval.
      let scanCheck: ReceiptCheck | null = null;
      if (guided) {
        // Fields already entered — compute the money columns. No AI here: the
        // receipt is verified in the background after approval, so the preview is
        // instant and the submitter isn't kept waiting.
        draft = computeReceipt({
          date: rs.draft?.date || new Date().toISOString().slice(0, 10),
          customerName: rs.draft?.customerName || "",
          productTy: rs.draft?.productTy || "",
          qty: Number(rs.draft?.qty) || 0,
          unitPrice: Number(rs.draft?.unitPrice) || 0,
          withhold: Number(rs.draft?.withhold) || 0,
          remark: rs.draft?.remark || "",
        });
      } else {
        // Scan mode still needs one read to fill the fields from the photo.
        const imgs: { base64: string; contentType: string }[] = [];
        let readErr = "";
        for (const id of rs.images.slice(0, 3)) {
          try {
            const bytes = await getFileBytes(id);
            if (bytes) imgs.push({ base64: bytes.base64, contentType: bytes.contentType });
            else readErr = "file record not found";
          } catch (e) {
            readErr = e instanceof Error ? e.message : String(e);
            console.error("getFileBytes (scan) failed:", e);
          }
        }
        if (imgs.length === 0) {
          await sendMessage(chatId, `⚠️ ደረሰኙን ማንበብ አልተቻለም${readErr ? `፦ ${readErr.slice(0, 200)}` : ""}። እባክዎ ድጋሚ ይላኩ።`, {
            reply_markup: receiptCollectKeyboard,
          });
          return NextResponse.json({ ok: true });
        }

        // Leave receipt_collect BEFORE the AI call, not after it. If this
        // invocation is killed mid-read, Telegram redelivers the update; with
        // the state still on receipt_collect the redelivery re-entered this
        // exact branch and started another read — the loop that made the bot
        // repeat "reading the receipt…" once a minute forever.
        rs.readingSince = Date.now();
        session.receiptScan = rs;
        session.state = "receipt_reading";
        await persist(session);

        await sendMessage(chatId, "⏳ ደረሰኙን በማንበብ ላይ...");
        const read = await extractSalesReceipt(imgs, text || undefined);

        if (!read.ok) {
          // Never save an unread receipt as a 0 ETB sale. Hand the session back
          // to photo collection and say what actually went wrong. The photos are
          // kept, so a transient failure only costs another tap on "ጨርሻለሁ".
          rs.readingSince = undefined;
          session.state = "receipt_collect";
          session.receiptScan = rs;
          await persist(session);
          console.error("extractSalesReceipt failed:", read.error);
          await sendMessage(
            chatId,
            `⚠️ ደረሰኙን ማንበብ አልተቻለም፦ <code>${escapeHtml(read.error.slice(0, 200))}</code>\n\n` +
              `ድጋሚ ለመሞከር "${RECEIPT_BTN.done}" ይጫኑ፣ ወይም ግልጽ የሆነ ፎቶ ይላኩ።`,
            { reply_markup: receiptCollectKeyboard }
          );
          return NextResponse.json({ ok: true });
        }
        draft = read.draft;
        scanCheck = {
          checked: true,
          score: read.confidence,
          flags: [],
          reasoning: read.notes,
          extracted: {
            productTy: draft.productTy,
            qty: draft.qty,
            unitPrice: draft.unitPrice,
            grandTotal: draft.printedGrandTotal ?? draft.grandTotal,
          },
          // Nothing to cross-check: in scan mode the extracted values ARE the
          // entered values.
          mismatches: [],
        };
      }

      rs.readingSince = undefined;
      rs.draft = draft;
      // Guided: verdict comes after approval. Scan: already known, so the
      // salesperson sees the read quality on the preview before approving.
      rs.check = scanCheck;
      session.receiptScan = rs;
      session.state = "receipt_action";
      await persist(session);
      await sendMessage(chatId, receiptPreview(draft, scanCheck), { reply_markup: receiptActionKeyboard });
      return NextResponse.json({ ok: true });
    }

    /* ── A read is already in flight for this chat ──
       Reached when a second message arrives while the AI is still working.
       Answer and return; never start a second read. */
    if (session.state === "receipt_reading") {
      const rs = (session.receiptScan || {}) as { readingSince?: number; images?: string[] };
      const elapsed = Date.now() - (Number(rs.readingSince) || 0);
      if (elapsed < READING_STALE_MS) {
        await sendMessage(chatId, "⏳ ደረሰኙ አሁንም እየተነበበ ነው። እባክዎ ጥቂት ይጠብቁ።");
        return NextResponse.json({ ok: true });
      }
      // Older than any read could legitimately take, so the invocation that
      // started it died. Recover to photo collection instead of leaving the
      // salesperson permanently stuck in a state nothing can exit. The already
      // uploaded photos are kept, so retrying is one tap.
      session.state = "receipt_collect";
      session.receiptScan = { ...rs, readingSince: undefined };
      await persist(session);
      await sendMessage(chatId, `⚠️ ደረሰኙን ማንበብ አልተጠናቀቀም። ድጋሚ ለመሞከር "${RECEIPT_BTN.done}" ይጫኑ።`, {
        reply_markup: receiptCollectKeyboard,
      });
      return NextResponse.json({ ok: true });
    }

    /* ── Sales report: preview → approve / edit ── */
    if (session.state === "receipt_action" && session.receiptScan?.draft) {
      const rs = session.receiptScan as {
        mode?: string;
        images: string[];
        draft: SalesReceiptDraft;
        check?: ReceiptCheck | null;
      };
      if (normText === NORM_RECEIPT.edit) {
        session.state = "receipt_edit";
        await persist(session);
        await sendMessage(
          chatId,
          '✏️ የሚስተካከለውን በ"መስክ: እሴት" መልኩ ይላኩ (በአንድ ጊዜ ብዙ መስመር መላክ ይችላሉ)። ምሳሌ፦\n' +
            "customer: Abebe Trading\nfsNo: 0012345\nattNo: 77\nproduct: ETL-9\nqty: 120\n" +
            "unitPrice: 850\nwithhold: 0\nbank: CBE\nremark: urgent\n\n" +
            "(fields: date, customer, fsNo, attNo, product, qty, unitPrice, withhold, bank, remark)\n" +
            "Sub Total፣ Vat እና Grand Total በራሳቸው ይሰላሉ።",
          { reply_markup: CHANGE_CANCEL_KEYBOARD }
        );
        return NextResponse.json({ ok: true });
      }
      if (normText === NORM_RECEIPT.approve) {
        const d = rs.draft;
        const imagesForCheck = rs.images || [];
        const guided = rs.mode !== "scan";
        // Saved as 'submitted', not 'processed': approving on the bot IS the act
        // of filing the report, so the row must show up on the dashboard Sales
        // tab and in its Excel download straight away.
        const insertReceipt = () => sql<{ id: string }[]>`
          insert into sales_receipts (date, customer_name, fs_no, att_no, product_ty, qty, unit_price,
                                      sub_total, vat, grand_total, withhold, net_pay, deposited_bank, remark,
                                      status, reported_by, photo_file_ids)
          values (${parseReportDate(d.date)}, ${d.customerName || null},
                  ${d.fsNo || null}, ${d.attNo || null},
                  ${d.productTy || null}, ${d.qty}, ${d.unitPrice}, ${d.subTotal}, ${d.vat}, ${d.grandTotal},
                  ${d.withhold}, ${d.netPay}, ${d.depositedBank || null}, ${d.remark || null},
                  'submitted', ${submitterName}, ${imagesForCheck})
          returning id
        `;
        let savedId: string | null = null;
        try {
          savedId = (await insertReceipt())[0]?.id ?? null;
        } catch (e) {
          // The sales_receipts table (0008) / remark column (0009) may not be
          // migrated yet — undefined_table (42P01) / undefined_column (42703).
          // Self-heal the schema and retry so the report reaches the dashboard.
          const code = (e as { code?: string })?.code;
          if (code !== "42P01" && code !== "42703") throw e;
          await ensureSalesReceiptsSchema();
          savedId = (await insertReceipt())[0]?.id ?? null;
        }
        await logActivity({
          chatId,
          actor: submitterName,
          userId: String(user._id),
          positions: user.positions,
          audience: "internal",
          action: "submission",
          detail: "sales_receipt",
        });
        session.receiptScan = { mode: rs.mode || "guided", images: [] };
        session.state = "receipt_next";
        await persist(session);
        await sendMessage(
          chatId,
          `✅ ተቀምጧል · Net Pay ${money(d.netPay)} ETB።\n` +
            `📤 ወደ ዳሽቦርድ ገብቷል — በሽያጭ ሪፖርት ውስጥ ይታያል።\n` +
            `🔎 ደረሰኙ በጀርባ በኩል እየተጣራ ነው — ልዩነት ካለ እናሳውቅዎታለን።\n` +
            `📊 የዛሬውን ወደ Excel ማውጣት ይችላሉ።`,
          { reply_markup: receiptNextKeyboard }
        );
        // Background: read the receipt and cross-check the
        // entered figures against what the AI reads off the photo. Updates the
        // row's confidence for the dashboard and pings the submitter on a mismatch.
        if (savedId) {
          await backgroundReceiptCheck({
            chatId,
            receiptId: savedId,
            images: imagesForCheck,
            entered: d,
            guided,
            // Scan mode already has its verdict from the read — reuse it instead
            // of paying for a second Gemini call on the same photo.
            preCheck: guided ? null : rs.check ?? null,
          });
        }
        return NextResponse.json({ ok: true });
      }
      await sendMessage(chatId, receiptPreview(rs.draft, rs.check), { reply_markup: receiptActionKeyboard });
      return NextResponse.json({ ok: true });
    }

    /* ── Sales report: apply field edits ── */
    if (session.state === "receipt_edit" && session.receiptScan?.draft && text) {
      const rs = session.receiptScan as {
        mode?: string;
        images: string[];
        draft: SalesReceiptDraft;
        check?: ReceiptCheck | null;
      };
      rs.draft = applyReceiptEdits(rs.draft, text);
      // Re-run the cross-check against the receipt's extracted figures, if we have them.
      if (rs.check) {
        const ex = rs.check.extracted;
        rs.check = {
          ...rs.check,
          mismatches: ex
            ? compareReceipt(rs.draft, {
                ...rs.draft,
                productTy: ex.productTy,
                qty: ex.qty,
                unitPrice: ex.unitPrice,
                // compareReceipt reads the PRINTED total, so the stored
                // extraction has to land there — leaving it on grandTotal alone
                // made this comparison silently do nothing.
                grandTotal: ex.grandTotal,
                printedGrandTotal: ex.grandTotal,
              })
            : [],
        };
      }
      session.receiptScan = rs;
      session.state = "receipt_action";
      await persist(session);
      await sendMessage(chatId, receiptPreview(rs.draft, rs.check), { reply_markup: receiptActionKeyboard });
      return NextResponse.json({ ok: true });
    }

    /* ── Sales receipt-scan: export today / submit / new ── */
    if (session.state === "receipt_next") {
      if (normText === NORM_RECEIPT.export) {
        const rows = await todaysSalesReceipts(submitterName);
        if (rows.length === 0) {
          await sendMessage(chatId, "ዛሬ ምንም የተመዘገበ ደረሰኝ የለም።", { reply_markup: receiptNextKeyboard });
          return NextResponse.json({ ok: true });
        }
        const buf = await buildSalesReceiptsWorkbook(rows, `Sales Report ${eatDateKey()}`);
        await sendDocument(
          chatId,
          {
            buffer: buf,
            filename: `sales-report-${eatDateKey()}.xlsx`,
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
          `📊 የዛሬው የሽያጭ ሪፖርት (${rows.length} ደረሰኝ)`
        );
        await sendMessage(chatId, "ተጨማሪ ማድረግ ይችላሉ።", { reply_markup: receiptNextKeyboard });
        return NextResponse.json({ ok: true });
      }
      // The button is gone from the keyboard (approving publishes directly), but
      // the handler stays: chats still showing the old keyboard keep working, and
      // it publishes any row left in 'processed' by the previous two-step flow.
      if (normText === NORM_RECEIPT.submit) {
        const updated = await sql<{ id: string }[]>`
          update sales_receipts set status = 'submitted', updated_at = now()
           where reported_by = ${submitterName} and status = 'processed'
          returning id`;
        await sendMessage(
          chatId,
          updated.length > 0
            ? `📤 ${updated.length} ደረሰኝ ወደ ዳሽቦርድ ገብቷል።`
            : "✅ ሁሉም ሪፖርቶች አስቀድመው ወደ ዳሽቦርድ ገብተዋል።",
          { reply_markup: receiptNextKeyboard }
        );
        return NextResponse.json({ ok: true });
      }
      if (normText === NORM_RECEIPT.again) {
        const mode = (session.receiptScan as { mode?: string })?.mode;
        if (mode === "scan") {
          session.state = "receipt_collect";
          session.receiptScan = { mode: "scan", images: [] };
          await persist(session);
          await sendMessage(chatId, `<b>${CAPABILITIES.sales_receipt_scan.button}</b>\n\n${CAPABILITIES.sales_receipt_scan.question}`, {
            reply_markup: receiptCollectKeyboard,
          });
        } else {
          session.state = "sales_entry";
          session.receiptScan = { mode: "guided", step: "date", images: [], draft: {} };
          await persist(session);
          await sendMessage(chatId, `<b>${CAPABILITIES.sales_report_entry.button}</b>\n\n${SALES_STEP_PROMPT.date}`, {
            reply_markup: salesEntryKeyboard,
          });
        }
        return NextResponse.json({ ok: true });
      }
      if (normText === NORM.back) {
        session.state = "idle";
        session.receiptScan = undefined;
        await persist(session);
        await sendRoleMenu(chatId, user);
        return NextResponse.json({ ok: true });
      }
      await sendMessage(chatId, "ከታች ካሉት አንዱን ይምረጡ።", { reply_markup: receiptNextKeyboard });
      return NextResponse.json({ ok: true });
    }

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
      // Admin/HR are receivers — they may never file a report.
      const allowed = !isReceiverOnly(user.positions) && capabilitiesFor(user.positions).some((c) => c.key === cap.key);

      if (!allowed) {
        await logActivity({
          chatId,
          actor: submitterName,
          userId: String(user._id),
          positions: user.positions,
          audience: audienceOf(session),
          action: "unauthorized",
          detail: cap.key,
          ok: false,
        });
        await sendRoleMenu(chatId, user, isReceiverOnly(user.positions) ? MSG.receiverOnly : MSG.noPermission);
        return NextResponse.json({ ok: true });
      }

      await logActivity({
        chatId,
        actor: submitterName,
        userId: String(user._id),
        positions: user.positions,
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

      if (cap.captureMode === "sales_entry") {
        session.state = "sales_entry";
        session.draft = undefined;
        session.capture = undefined;
        session.history = [];
        session.receiptScan = { mode: "guided", step: "date", images: [], draft: {} };
        await persist(session);
        await sendMessage(chatId, `<b>${cap.button}</b>\n\n${SALES_STEP_PROMPT.date}`, { reply_markup: salesEntryKeyboard });
        return NextResponse.json({ ok: true });
      }

      if (cap.captureMode === "receipt_scan") {
        session.state = "receipt_collect";
        session.draft = undefined;
        session.capture = undefined;
        session.history = [];
        session.receiptScan = { mode: "scan", images: [] };
        await persist(session);
        await sendMessage(chatId, `<b>${cap.button}</b>\n\n${cap.question}`, { reply_markup: receiptCollectKeyboard });
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

      const { reply, ref } = await saveCapture(session, user);
      await finalizeSubmission(session, ref, capture.capKey, capture.hrKind);
      await logActivity({
        chatId,
        actor: user.fullName,
        userId: String(user._id),
        positions: user.positions,
        audience: "internal",
        action: "submission",
        detail: capture.capKey === "hr" ? `hr:${capture.hrKind}` : capture.capKey,
        meta: { photos: capture.photoFileIds.length, ...(ref ? { table: ref.table, recordId: ref.id } : {}) },
      });

      session.state = "idle";
      session.capture = undefined;
      await persist(session);
      await sendMessage(chatId, reply, ref ? { reply_markup: editMarkup(ref) } : {});
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

    /* ── LLM ingestion: Excel sheet upload ── */
    if (
      session.state === "awaiting_metadata" &&
      session.draft &&
      msg.document &&
      isSpreadsheetMime(msg.document.mime_type, msg.document.file_name)
    ) {
      const dl = await downloadTelegramFile(msg.document.file_id);
      let sheetText = "";
      if (dl) {
        try {
          sheetText = await spreadsheetToText(dl.buffer);
        } catch {
          sheetText = "";
        }
      }
      if (!sheetText) {
        await sendMessage(chatId, "⚠️ የExcel ሉሁን ማንበብ አልተቻለም። እባክዎ እንደ ጽሑፍ ይላኩ ወይም ፎቶ ያንሱ።", {
          reply_markup: CHANGE_CANCEL_KEYBOARD,
        });
        return NextResponse.json({ ok: true });
      }

      session.history.push({ role: "user", content: sheetText.slice(0, 4000) });
      const extraction = await classifyIngestion({
        text: sheetText,
        priorDraft: {
          docType: session.draft.docType,
          fields: session.draft.extracted,
          missing: session.draft.missing,
        },
        history: session.history,
      });
      const docType = session.draft.docType || extraction.docType;

      if (extraction.complete) {
        const capKey = session.draft.capKey || docType;
        const { reply, ref } = await saveExtractedRecord(
          { ...extraction, docType: docType as IngestionExtraction["docType"] },
          { userName: submitterName }
        );
        await finalizeSubmission(session, ref, capKey);
        await logActivity({
          chatId,
          actor: submitterName,
          userId: String(user._id),
          positions: user.positions,
          audience: audienceOf(session),
          action: "submission",
          detail: docType,
          meta: { fromExcel: true, ...(ref ? { table: ref.table, recordId: ref.id } : {}) },
        });
        session.state = "idle";
        session.draft = undefined;
        session.history = [];
        await persist(session);
        await sendMessage(chatId, reply, ref ? { reply_markup: editMarkup(ref) } : {});
        await sendRoleMenu(chatId, user);
      } else {
        session.draft = { ...session.draft, docType, extracted: extraction.fields, missing: extraction.missing };
        await persist(session);
        await sendMessage(chatId, extraction.question, { reply_markup: CHANGE_CANCEL_KEYBOARD });
      }
      return NextResponse.json({ ok: true });
    }

    /* ── LLM ingestion: photo ── */
    if (hasPhoto(msg)) {
      if (session.state !== "awaiting_metadata" || !session.draft) {
        await sendRoleMenu(chatId, user, MSG.pickReportFirst);
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
        const capKey = session.draft.capKey || docType;
        const { reply, ref } = await saveExtractedRecord(
          { ...extraction, docType: docType as IngestionExtraction["docType"] },
          { fileId: stored.id, userName: submitterName }
        );
        await finalizeSubmission(session, ref, capKey);
        await logActivity({
          chatId,
          actor: submitterName,
          userId: String(user._id),
          positions: user.positions,
          audience: audienceOf(session),
          action: "submission",
          detail: docType,
          meta: { hasPhoto: true, ...(ref ? { table: ref.table, recordId: ref.id } : {}) },
        });
        session.state = "idle";
        session.draft = undefined;
        session.history = [];
        await persist(session);
        await sendMessage(chatId, reply, ref ? { reply_markup: editMarkup(ref) } : {});
        await sendRoleMenu(chatId, user);
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
        const capKey = session.draft.capKey || docType;
        const { reply, ref } = await saveExtractedRecord(
          { ...extraction, docType: docType as IngestionExtraction["docType"] },
          { fileId: session.draft.fileId, userName: submitterName }
        );
        await finalizeSubmission(session, ref, capKey);
        await logActivity({
          chatId,
          actor: submitterName,
          userId: String(user._id),
          positions: user.positions,
          audience: audienceOf(session),
          action: "submission",
          detail: docType,
          meta: ref ? { table: ref.table, recordId: ref.id } : undefined,
        });
        session.state = "idle";
        session.draft = undefined;
        session.history = [];
        await persist(session);
        await sendMessage(chatId, reply, ref ? { reply_markup: editMarkup(ref) } : {});
        await sendRoleMenu(chatId, user);
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

      if (!isReceiverOnly(user.positions) && caps.some((c) => c.key === "ops") && isOpsReportText(text)) {
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

      // The bot is a structured input system, not a chatbot: stray free text is
      // not answered by an AI. Guide the user back to their menu instead.
      await sendRoleMenu(chatId, user, "እባክዎ ከታች ካሉት ሜኑዎች ውስጥ ይምረጡ። ይህ ቦት ለሪፖርት ማስገቢያ ብቻ ነው።");
      return NextResponse.json({ ok: true });
    }

    await sendEntryMenu(chatId);
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
