import OpenAI from "openai";
import { envValue } from "@/lib/env";

/* ─────────────────────────────── AI providers ──────────────────────────────
 * Text (chat, morning brief, report extraction) → NVIDIA Nemotron-3.
 * Images (receipts, stone quality, damage photos, photo extraction) → Qwen-VL.
 * Both speak the OpenAI-compatible API, so we use the OpenAI SDK with two
 * baseURL/key pairs. Base URL + model are env-overridable because the exact
 * provider behind QWEN_API / the NVIDIA key can vary.
 */

const NVIDIA_BASE = envValue("NVIDIA_BASE_URL") || "https://integrate.api.nvidia.com/v1";
export const TEXT_MODEL = envValue("NEMOTRON_MODEL") || "nvidia/nemotron-3-ultra-550b-a55b";

const QWEN_BASE = envValue("QWEN_BASE_URL") || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
export const VISION_MODEL = envValue("QWEN_MODEL") || "qwen-vl-max-latest";

// Google Gemini — the ONLY reader for sales receipts. Uses the NATIVE
// generateContent REST API (not the OpenAI-compat shim, which can be flaky with
// AI-Studio keys); this is the same request the google-genai SDK sends.
export const GEMINI_BASE = envValue("GEMINI_BASE_URL") || "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_MODEL = envValue("GEMINI_MODEL") || "gemini-3.5-flash-lite";

/**
 * Hard ceiling for a receipt read, in ms.
 *
 * This runs inside the Telegram webhook, and the webhook MUST answer 200 before
 * the serverless function is killed — an unanswered update is redelivered
 * forever. On Vercel Hobby the budget is small, so 8s leaves room for the
 * storage downloads and the reply that follow. Never raise this above the
 * function's maxDuration minus a comfortable margin.
 */
export const RECEIPT_BUDGET_MS = Number(envValue("GEMINI_TIMEOUT_MS")) || 8000;

function nvidiaKey(): string {
  return envValue("NIVIDA_API_KEY") || envValue("NVIDIA_API_KEY");
}

/** True when the text model (Nemotron) key is configured. */
export function isAiConfigured(): boolean {
  return nvidiaKey().length > 0;
}
// Back-compat: some call sites still import isOpenAIConfigured.
export const isOpenAIConfigured = isAiConfigured;

let _textClient: OpenAI | null = null;
let _textKey = "";
/** Nemotron (NVIDIA) — text / reasoning only. */
export function textAI(): OpenAI {
  const apiKey = nvidiaKey();
  if (!apiKey) {
    throw new Error(
      "NIVIDA_API_KEY is required for AI text (chat, morning brief, report extraction). Add it in Vercel env and redeploy."
    );
  }
  if (!_textClient || _textKey !== apiKey) {
    // Hard timeout + no retry storm: a slow or unresponsive endpoint must fail
    // fast (surfaced as an error) rather than hang the serverless function past
    // its maxDuration, which leaves the UI spinner stuck forever.
    _textClient = new OpenAI({ apiKey, baseURL: NVIDIA_BASE, timeout: 20000, maxRetries: 0 });
    _textKey = apiKey;
  }
  return _textClient;
}

let _visionClient: OpenAI | null = null;
let _visionKey = "";
/** Qwen-VL — reads images. */
export function visionAI(): OpenAI {
  const apiKey = envValue("QWEN_API");
  if (!apiKey) {
    throw new Error(
      "QWEN_API is required for image reading (receipts, stone quality, damage photos). Add it in Vercel env and redeploy."
    );
  }
  if (!_visionClient || _visionKey !== apiKey) {
    _visionClient = new OpenAI({ apiKey, baseURL: QWEN_BASE, timeout: 40000, maxRetries: 0 });
    _visionKey = apiKey;
  }
  return _visionClient;
}

/**
 * Robust JSON extraction. Off-OpenAI models don't reliably honour json_object
 * mode, and reasoning models can wrap output in <think> tags or ``` fences —
 * so pull out the first balanced {...} object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractJson(raw?: string | null): any {
  if (!raw) return {};
  let s = String(raw).trim();
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, "");
  s = s.replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  if (start === -1) return {};
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return {};
        }
      }
    }
  }
  try {
    return JSON.parse(s.slice(start));
  } catch {
    return {};
  }
}

/* ───────────────────── Claim photo fraud / validity check ─────────────────── */

export interface PhotoVerdict {
  bag_visible: boolean;
  matches_bag_type: boolean;
  damage_visible: boolean;
  damage_severity: "none" | "minor" | "moderate" | "severe";
  suspicious: boolean;
  suspicion_reasons: string[];
  notes: string;
  aiCountedBags: number | null;
}

const PHOTO_VERDICT_FALLBACK: PhotoVerdict = {
  bag_visible: false,
  matches_bag_type: false,
  damage_visible: false,
  damage_severity: "none",
  suspicious: true,
  suspicion_reasons: ["ai_check_failed"],
  notes: "Automatic check failed; manual review required.",
  aiCountedBags: null,
};

export async function checkClaimPhoto(
  imageBase64: string,
  contentType: string,
  bagType: string
): Promise<PhotoVerdict> {
  try {
    const res = await visionAI().chat.completions.create({
      model: VISION_MODEL,
      max_tokens: 500,
      messages: [
        {
          role: "system",
          content:
            "You are a quality-control inspector for a mining company's bag damage claims. " +
            "Inspect the photo and answer STRICTLY as JSON with these keys: " +
            "bag_visible (boolean), matches_bag_type (boolean — does the bag look like the registered type?), " +
            "damage_visible (boolean), damage_severity ('none'|'minor'|'moderate'|'severe'), " +
            "suspicious (boolean), suspicion_reasons (array of strings from: 'screenshot', 'photo_of_screen', " +
            "'heavy_blur', 'stock_photo_look', 'no_bag', 'other'), notes (short string), " +
            "counted_bags (integer — count of visibly damaged/torn bags in the image; null if the image is too unclear to count). " +
            "Mark suspicious=true if the image looks like a screenshot (UI elements, status bars, crops), " +
            "a photo of another screen (moiré patterns, glare, pixels), or is too blurred to verify damage.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Bag type for this claim: "${bagType}". Count the damaged bags and inspect this damage-claim photo.` },
            { type: "image_url", image_url: { url: `data:${contentType};base64,${imageBase64}`, detail: "high" } },
          ],
        },
      ],
    });
    const parsed = extractJson(res.choices[0]?.message?.content);
    const rawCount = parsed.counted_bags;
    return {
      bag_visible: !!parsed.bag_visible,
      matches_bag_type: !!parsed.matches_bag_type,
      damage_visible: !!parsed.damage_visible,
      damage_severity: ["none", "minor", "moderate", "severe"].includes(parsed.damage_severity)
        ? parsed.damage_severity
        : "none",
      suspicious: !!parsed.suspicious,
      suspicion_reasons: Array.isArray(parsed.suspicion_reasons) ? parsed.suspicion_reasons.map(String) : [],
      notes: String(parsed.notes || ""),
      aiCountedBags: rawCount !== null && rawCount !== undefined && !isNaN(Number(rawCount)) ? Math.round(Number(rawCount)) : null,
    };
  } catch (e) {
    console.error("checkClaimPhoto failed:", e);
    return PHOTO_VERDICT_FALLBACK;
  }
}

/* ───────────────────── Gemini sales-receipt extraction ─────────────────────── */

export interface GeminiReceipt {
  date: string;
  customerName: string;
  fsNo: string; // "FS No" — fiscal receipt serial number
  attNo: string; // "Att. No" — attachment / machine number
  productTy: string;
  qty: number;
  unitPrice: number;
  subTotal: number;
  vat: number;
  grandTotal: number;
  withhold: number;
  netPay: number;
  depositedBank: string;
  confidence: number; // 0-100, how legible / genuine the receipt looks
  notes: string;
}

/**
 * One call reads every reported column plus the stamp verdict.
 *
 * The multi-image instruction matters: the bot sends up to 3 photos of the SAME
 * receipt (front, back, a close-up) in a single request, and they have to be
 * merged into ONE row — not read as three separate sales.
 */
const GEMINI_RECEIPT_SYSTEM =
  "You read Ethiopian sales receipts / cash-sale invoices and return STRICT JSON only.\n" +
  "IMPORTANT: every image you are given is a page or angle of ONE SINGLE receipt. Merge what you can " +
  "read across them into ONE result: if a field is legible in any image, use it. Never return several " +
  "receipts, and never add quantities or totals across images.\n" +
  'Return exactly: { "date": "YYYY-MM-DD", "customerName": string, ' +
  '"fsNo": string (the "FS No" / fiscal receipt serial number, digits as printed), ' +
  '"attNo": string (the "Att. No" / attachment or machine number), ' +
  '"productTy": string (product code such as ETL-9, 3-EL, EC-15, Talc), "qty": number, ' +
  '"unitPrice": number (ETB), "subTotal": number (ETB before VAT), "vat": number (ETB VAT 15%), ' +
  '"grandTotal": number (ETB total incl. VAT), ' +
  '"withhold": number (ETB withholding if shown, else 0), ' +
  '"netPay": number (ETB payable after withholding; 0 if not printed), ' +
  '"depositedBank": string (bank the money was deposited to, if the receipt shows one, else ""), ' +
  '"confidence": number (0-100 — how clearly legible and genuine the receipt looks), ' +
  '"notes": string (one short sentence) }.\n' +
  "Read every number exactly as printed — do NOT calculate or correct them. A printed total that " +
  "disagrees with its own line items must be reported as printed, because that disagreement is " +
  'precisely what the cross-check looks for. Use "" for text and 0 for numbers that are not visible.';

function receiptNum(v: unknown): number {
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}

/**
 * Outcome of a receipt read. Deliberately NOT `GeminiReceipt | null`: a null
 * cannot distinguish "the model read a blank receipt" from "the key was
 * rejected" or "that model name does not exist", and the caller has to tell the
 * salesperson which of those happened. Silently degrading a failed read into a
 * zeroed draft is how an unreadable photo became a real sales row of 0 ETB.
 */
export type ReceiptReadResult =
  | { ok: true; data: GeminiReceipt }
  | { ok: false; error: string };

/**
 * Extract a sales receipt with Gemini (fields + stamp + confidence in one call),
 * via the NATIVE generateContent REST API — inline_data parts, exactly like the
 * google-genai SDK sends. This is more reliable than the OpenAI-compat shim.
 *
 * Bounded by RECEIPT_BUDGET_MS because it runs inside the Telegram webhook.
 */
/* ─────────────────────── Shared Gemini REST transport ──────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GeminiPart = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export interface GeminiCallResult {
  ok: boolean;
  /** Concatenated text parts of the first candidate. */
  text: string;
  /** Function calls the model asked for, when tools were supplied. */
  calls: { name: string; args: Record<string, unknown> }[];
  error?: string;
}

/**
 * One place that knows how to talk to Gemini's native generateContent API.
 *
 * Everything Gemini-backed goes through here — receipt reading, the damaged-tool
 * check and the dashboard chat — so the auth header, the timeout discipline and
 * the "404 means wrong model for this key" diagnosis exist exactly once.
 */
export async function geminiGenerate(
  contents: GeminiContent[],
  opts: {
    json?: boolean;
    temperature?: number;
    timeoutMs?: number;
    maxOutputTokens?: number;
    /** Real system prompt. Gemini has no system role — this is its own field. */
    systemInstruction?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools?: any[];
    /** e.g. { functionCallingConfig: { mode: "ANY" } } to require a tool call. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toolConfig?: any;
  } = {}
): Promise<GeminiCallResult> {
  const key = envValue("GEMINI_API_KEY");
  if (!key) return { ok: false, text: "", calls: [], error: "GEMINI_API_KEY is not set" };

  const budget = opts.timeoutMs ?? RECEIPT_BUDGET_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), budget);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const generationConfig: Record<string, any> = { temperature: opts.temperature ?? 0 };
    // responseMimeType and tools are mutually exclusive in the API: asking for
    // forced JSON disables function calling entirely.
    if (opts.json && !opts.tools) generationConfig.responseMimeType = "application/json";
    if (opts.maxOutputTokens) generationConfig.maxOutputTokens = opts.maxOutputTokens;

    const res = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      // Key goes in the header, not the query string — a key in a URL ends up in
      // every proxy and access log between here and Google.
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents,
        generationConfig,
        ...(opts.systemInstruction ? { system_instruction: { parts: [{ text: opts.systemInstruction }] } } : {}),
        ...(opts.tools ? { tools: opts.tools } : {}),
        ...(opts.toolConfig ? { toolConfig: opts.toolConfig } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 500);
      console.error("Gemini generateContent failed:", res.status, body);
      // 404 here almost always means GEMINI_MODEL is wrong for this key, which
      // is worth saying out loud rather than leaving as a bare status code.
      const hint = res.status === 404 ? ` (model "${GEMINI_MODEL}" not available for this key)` : "";
      return { ok: false, text: "", calls: [], error: `Gemini HTTP ${res.status}${hint}` };
    }
    const data = (await res.json()) as {
      candidates?: {
        content?: { parts?: { text?: string; functionCall?: { name?: string; args?: unknown } }[] };
      }[];
    };
    const parts = data.candidates?.[0]?.content?.parts || [];
    return {
      ok: true,
      text: parts.map((pt) => pt.text || "").join(""),
      calls: parts
        .filter((pt) => pt.functionCall?.name)
        .map((pt) => ({
          name: String(pt.functionCall!.name),
          args: (pt.functionCall!.args as Record<string, unknown>) || {},
        })),
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    console.error("geminiGenerate failed:", e);
    return {
      ok: false,
      text: "",
      calls: [],
      error: aborted ? `Gemini timed out after ${budget}ms` : e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function extractReceiptGemini(
  images: { base64: string; contentType: string }[],
  caption?: string
): Promise<ReceiptReadResult> {
  if (images.length === 0) return { ok: false, error: "no images to read" };

  const parts: GeminiPart[] = images.slice(0, 3).map((img) => ({
    inline_data: { mime_type: img.contentType || "image/jpeg", data: img.base64 },
  }));
  parts.push({ text: GEMINI_RECEIPT_SYSTEM + (caption ? `\nNote: ${caption}` : "") });

  const res = await geminiGenerate([{ role: "user", parts }], { json: true });
  if (!res.ok) return { ok: false, error: res.error || "Gemini call failed" };
  if (!res.text.trim()) return { ok: false, error: "Gemini returned an empty response" };

  try {
    const p = extractJson(res.text);
    return {
      ok: true,
      data: {
        date: String(p.date || ""),
        customerName: String(p.customerName || ""),
        fsNo: String(p.fsNo || "").trim(),
        attNo: String(p.attNo || "").trim(),
        productTy: String(p.productTy || ""),
        qty: receiptNum(p.qty),
        unitPrice: receiptNum(p.unitPrice),
        subTotal: receiptNum(p.subTotal),
        vat: receiptNum(p.vat),
        grandTotal: receiptNum(p.grandTotal),
        withhold: receiptNum(p.withhold),
        netPay: receiptNum(p.netPay),
        depositedBank: String(p.depositedBank || "").trim(),
        confidence: Math.max(0, Math.min(100, Math.round(Number(p.confidence) || 50))),
        notes: String(p.notes || ""),
      },
    };
  } catch (e) {
    // Transport failures are already handled above; reaching here means the
    // model returned something that is not the JSON we asked for.
    console.error("extractReceiptGemini could not parse the response:", e);
    return { ok: false, error: "Gemini returned an unreadable response" };
  }
}

/* ──────────────────── Damaged-tool photo check (Gemini) ─────────────────────
 * Backs the maintenance branch of a tool purchase request: does the photo
 * actually show the damage being claimed?
 */

export interface ToolPhotoCheck {
  /** False means the check did not run — NOT that the photo is suspect. */
  checked: boolean;
  plausible: boolean;
  confidence: number; // 0-100
  observations: string;
}

export async function analyseToolPhoto(
  image: { base64: string; contentType: string },
  toolName: string,
  quantity?: number
): Promise<ToolPhotoCheck> {
  const prompt =
    "You are checking a maintenance request at an Ethiopian stone-crushing plant. " +
    `The employee says this photo shows a damaged/worn item: "${toolName}"` +
    (quantity ? ` (quantity ${quantity})` : "") +
    ".\nReturn STRICT JSON only: " +
    '{ "plausible": boolean (does the photo genuinely show the stated item, and does it show real ' +
    'damage or wear?), "confidence": number (0-100, how sure you are), ' +
    '"observations": string (one or two short sentences describing what you actually see — the visible ' +
    "damage, or why the photo does not support the claim) }.\n" +
    "Judge only what is visible. A clear photo of an undamaged item is plausible:false. A photo too " +
    "blurred or dark to tell should get a LOW confidence rather than a false accusation.";

  const res = await geminiGenerate(
    [
      {
        role: "user",
        parts: [
          { inline_data: { mime_type: image.contentType || "image/jpeg", data: image.base64 } },
          { text: prompt },
        ],
      },
    ],
    { json: true }
  );

  // A failed call must never read as "the photo is fake". Same distinction the
  // receipt check makes: not-checked is its own outcome.
  if (!res.ok || !res.text.trim()) {
    return {
      checked: false,
      plausible: false,
      confidence: 0,
      observations: res.error || "the photo check did not run",
    };
  }
  try {
    const p = extractJson(res.text);
    return {
      checked: true,
      plausible: !!p.plausible,
      confidence: Math.max(0, Math.min(100, Math.round(Number(p.confidence) || 0))),
      observations: String(p.observations || ""),
    };
  } catch {
    return { checked: false, plausible: false, confidence: 0, observations: "unreadable AI response" };
  }
}

/* ──────────────────── PP bag damage photo check (3 tiers) ───────────────────
 * Gemini → Qwen-VL → Nemotron.
 *
 * Nemotron is text-only, so at that last tier the photo is NOT looked at: it can
 * only weigh whether the stated reason and quantity are coherent. That is
 * reported honestly via `photoAnalysed: false` rather than dressed up as a photo
 * verdict — a judgement nobody made must never be presented as one.
 *
 * MUST NOT run inline in the Telegram webhook. A provider chain is exactly what
 * once ran past the function limit and left updates unacknowledged, so Telegram
 * redelivered them forever (see src/lib/receipt-scan.ts). Call it after the
 * report is saved and the user has been answered.
 */

export interface DamagePhotoCheck {
  /** False means no tier answered — NOT that the photo is suspect. */
  checked: boolean;
  /** False when the verdict was reached without actually looking at the image. */
  photoAnalysed: boolean;
  provider: "gemini" | "qwen" | "nemotron" | "none";
  plausible: boolean;
  confidence: number; // 0-100
  observations: string;
}

const DAMAGE_PROMPT =
  "You are inspecting a damage report for PP (polypropylene) bags at an Ethiopian " +
  "stone-crushing plant. PP bags are the woven plastic sacks the crushed stone is packed in.\n" +
  "Return STRICT JSON only: { \"plausible\": boolean (does the photo genuinely show PP bags, " +
  "and damage consistent with the stated reason and quantity?), \"confidence\": number (0-100), " +
  '"observations": string (one or two short sentences describing what you actually see) }.\n' +
  "Judge only what is visible. A photo that is a screenshot, a picture of another screen, or " +
  "too blurred to assess should get LOW confidence rather than a false accusation.";

function damageContext(reason: string, quantity: number): string {
  return `Stated reason: "${reason}". Stated quantity: ${quantity} bags.`;
}

function parseDamageVerdict(
  raw: string,
  provider: DamagePhotoCheck["provider"],
  photoAnalysed: boolean
): DamagePhotoCheck | null {
  try {
    const p = extractJson(raw);
    if (p == null || typeof p !== "object") return null;
    return {
      checked: true,
      photoAnalysed,
      provider,
      plausible: !!p.plausible,
      confidence: Math.max(0, Math.min(100, Math.round(Number(p.confidence) || 0))),
      observations: String(p.observations || ""),
    };
  } catch {
    return null;
  }
}

export async function analyseDamagePhoto(
  image: { base64: string; contentType: string },
  reason: string,
  quantity: number
): Promise<DamagePhotoCheck> {
  const context = damageContext(reason, quantity);

  // Tier 1 — Gemini.
  try {
    const res = await geminiGenerate(
      [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: image.contentType || "image/jpeg", data: image.base64 } },
            { text: `${DAMAGE_PROMPT}\n${context}` },
          ],
        },
      ],
      { json: true, timeoutMs: 15000 }
    );
    if (res.ok && res.text.trim()) {
      const verdict = parseDamageVerdict(res.text, "gemini", true);
      if (verdict) return verdict;
    }
    console.warn("analyseDamagePhoto: Gemini tier unusable —", res.error || "unparseable");
  } catch (e) {
    console.warn("analyseDamagePhoto: Gemini tier threw —", e);
  }

  // Tier 2 — Qwen-VL. Still a real look at the image.
  try {
    const res = await visionAI().chat.completions.create({
      model: VISION_MODEL,
      max_tokens: 400,
      messages: [
        { role: "system", content: DAMAGE_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: context },
            {
              type: "image_url",
              image_url: { url: `data:${image.contentType};base64,${image.base64}`, detail: "high" },
            },
          ],
        },
      ],
    });
    const verdict = parseDamageVerdict(res.choices[0]?.message?.content || "", "qwen", true);
    if (verdict) return verdict;
    console.warn("analyseDamagePhoto: Qwen tier returned an unparseable verdict");
  } catch (e) {
    console.warn("analyseDamagePhoto: Qwen tier threw —", e);
  }

  // Tier 3 — Nemotron, text only. It cannot see the photo, so it judges only
  // whether the written reason and the quantity hang together.
  try {
    const res = await textAI().chat.completions.create({
      model: TEXT_MODEL,
      max_tokens: 300,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ chat_template_kwargs: { enable_thinking: false } } as any),
      messages: [
        {
          role: "system",
          content:
            "You assess a PP bag damage report at an Ethiopian stone-crushing plant. " +
            "You CANNOT see the photo — judge only whether the written reason is a coherent " +
            "explanation for the stated quantity of damaged bags.\n" +
            'Return STRICT JSON only: { "plausible": boolean, "confidence": number (0-100), ' +
            '"observations": string }. Say explicitly that the photo was not examined.',
        },
        { role: "user", content: context },
      ],
    });
    const verdict = parseDamageVerdict(res.choices[0]?.message?.content || "", "nemotron", false);
    if (verdict) {
      return {
        ...verdict,
        observations:
          `[Photo not analysed — image models unavailable] ${verdict.observations}`.trim(),
      };
    }
  } catch (e) {
    console.warn("analyseDamagePhoto: Nemotron tier threw —", e);
  }

  return {
    checked: false,
    photoAnalysed: false,
    provider: "none",
    plausible: false,
    confidence: 0,
    observations: "No AI provider was available to check this photo.",
  };
}

/* ───────────────────────── Receipt QR-code check ───────────────────────────── */

export interface QRCheckResult {
  hasQRCode: boolean;
  confidence: number; // 0–1
  notes: string;
}

export async function checkReceiptQRCode(imageBase64: string, contentType: string): Promise<QRCheckResult> {
  try {
    const res = await visionAI().chat.completions.create({
      model: VISION_MODEL,
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            "You inspect receipt photos submitted to an Ethiopian mining company's accounting system. " +
            'Return STRICT JSON: { "hasQRCode": boolean, "confidence": 0-1, "notes": "one short sentence" }. ' +
            "Set hasQRCode=true ONLY if a QR code (square matrix barcode with dark squares on a white background) " +
            "is clearly visible anywhere on the receipt. " +
            "Ethiopian ERCA tax receipts always include a QR code — that is the standard to check against. " +
            "Do NOT confuse regular barcodes, logos, stamps, or decorative patterns for QR codes.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Does this receipt contain a QR code? Inspect every part of the image carefully." },
            { type: "image_url", image_url: { url: `data:${contentType};base64,${imageBase64}`, detail: "high" } },
          ],
        },
      ],
    });
    const parsed = extractJson(res.choices[0]?.message?.content);
    return {
      hasQRCode: !!parsed.hasQRCode,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
      notes: String(parsed.notes || ""),
    };
  } catch (e) {
    console.error("checkReceiptQRCode failed:", e);
    // On AI failure, do not block a legitimate receipt — assume QR present
    return { hasQRCode: true, confidence: 0, notes: "check_failed" };
  }
}

/* ───────────────────────── Gate stone quality scoring ─────────────────────── */

export interface StoneScore {
  visible_stone: boolean;
  qualityGrade: "good" | "fair" | "dark/weathered";
  confidence: number;
  reasons: string[];
  recommendation: string;
}

const STONE_SCORE_FALLBACK: StoneScore = {
  visible_stone: false,
  qualityGrade: "fair",
  confidence: 0,
  reasons: ["ai_check_failed"],
  recommendation: "Hold for manual gate review before unloading.",
};

export async function scoreStonePhoto(imageBase64: string, contentType: string): Promise<StoneScore> {
  try {
    const res = await visionAI().chat.completions.create({
      model: VISION_MODEL,
      max_tokens: 350,
      messages: [
        {
          role: "system",
          content:
            "You inspect raw stone arriving at a mining/crushing site gate. Return STRICT JSON with: " +
            "visible_stone (boolean), qualityGrade ('good'|'fair'|'dark/weathered'), confidence (0 to 1), " +
            "reasons (short string array), recommendation (short operational action). " +
            "Mark dark/weathered when the load appears unusually dark, weathered, contaminated, wet, clay-heavy, or likely to produce bad product.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Score this truckload of incoming raw stone for production suitability." },
            { type: "image_url", image_url: { url: `data:${contentType};base64,${imageBase64}`, detail: "low" } },
          ],
        },
      ],
    });
    const parsed = extractJson(res.choices[0]?.message?.content);
    const qualityGrade = ["good", "fair", "dark/weathered"].includes(parsed.qualityGrade) ? parsed.qualityGrade : "fair";
    return {
      visible_stone: !!parsed.visible_stone,
      qualityGrade,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String).slice(0, 6) : [],
      recommendation: String(parsed.recommendation || ""),
    };
  } catch (e) {
    console.error("scoreStonePhoto failed:", e);
    return STONE_SCORE_FALLBACK;
  }
}

/* ─────────────────────── Morning brief narrative writer ───────────────────── */

/**
 * The dashboard's ✦ AI morning brief card.
 *
 * On Gemini, not Nemotron. This is the only AI element on the dashboard home,
 * and it renders solely from `briefs.narrative` — so when the Nemotron key was
 * absent the catch below returned "" and the card silently vanished, which reads
 * as the dashboard AI being dead. Keeping it on the same key as everything else
 * removes that failure mode.
 */
export async function writeBriefNarrative(structured: Record<string, unknown>): Promise<string> {
  const system =
    "You write the CEO morning brief for MinTech Ethiopia, a mining company. " +
    "You are given structured data computed directly from the database. " +
    "RULES: Never invent, round differently, or extrapolate any number — quote figures exactly as given. " +
    "Lead with exceptions (most urgent first), then a crisp narrative of yesterday. " +
    "Plain text only, no markdown headers. 4–7 short sentences. Confident, factual tone. " +
    "Currency is ETB. Address it to Mr. Anteneh implicitly (no greeting needed).";

  const res = await geminiGenerate([{ role: "user", parts: [{ text: JSON.stringify(structured) }] }], {
    systemInstruction: system,
    temperature: 0.4,
    maxOutputTokens: 500,
    // The brief runs from a cron, not a webhook, so it can afford longer than
    // the receipt reader's budget.
    timeoutMs: 20000,
  });

  if (!res.ok) {
    // An empty narrative hides the card rather than breaking the brief — the
    // five lines beside it are rendered from queries and stand on their own.
    console.error("writeBriefNarrative failed:", res.error);
    return "";
  }
  return res.text.trim();
}

/* ─────────────────── General request legitimacy scoring ───────────────────── */

export interface LegitimacyVerdict {
  score: number; // 0-100
  flags: string[];
  reasoning: string;
}

const LEGITIMACY_FALLBACK: LegitimacyVerdict = {
  score: 50,
  flags: ["ai_check_failed"],
  reasoning: "Automatic legitimacy check failed; manual review required.",
};

export async function verifyRequestLegitimacy(
  imageBase64: string,
  contentType: string,
  docType: string,
  context?: string
): Promise<LegitimacyVerdict> {
  const typeDescriptions: Record<string, string> = {
    receipt: "a payment receipt or invoice from a vendor",
    purchase_request: "supporting evidence for a purchase request (item photo, quotation, or related document)",
    damage_claim: "a photo showing bag damage at a factory or warehouse",
    stone_delivery: "a truck delivering raw stone to a gate",
    other: "a business document",
  };
  const docDesc = typeDescriptions[docType] || typeDescriptions.other;

  try {
    const res = await visionAI().chat.completions.create({
      model: VISION_MODEL,
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content:
            "You are a fraud-detection analyst for an Ethiopian mining company. " +
            "Inspect the submitted photo and score its legitimacy as a business document. " +
            "Return STRICT JSON: " +
            '{ "score": 0-100, "flags": string[], "reasoning": "one short sentence" }. ' +
            "Score 90-100: clearly genuine. 65-89: likely genuine, minor concerns. 35-64: suspicious, needs review. 0-34: likely fraudulent. " +
            "Flags (use any that apply): screenshot, photo_of_screen, heavy_blur, appears_edited, unrelated_content, " +
            "no_document_visible, inconsistent_amounts, stock_photo, low_lighting, partial_crop.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `This photo was submitted as: ${docDesc}.${context ? ` Context: ${context}` : ""} Score its legitimacy.`,
            },
            { type: "image_url", image_url: { url: `data:${contentType};base64,${imageBase64}`, detail: "low" } },
          ],
        },
      ],
    });
    const parsed = extractJson(res.choices[0]?.message?.content);
    return {
      score: Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 50))),
      flags: Array.isArray(parsed.flags) ? parsed.flags.map(String).slice(0, 8) : [],
      reasoning: String(parsed.reasoning || ""),
    };
  } catch (e) {
    console.error("verifyRequestLegitimacy failed:", e);
    return LEGITIMACY_FALLBACK;
  }
}

/* ──────────────── Telegram ingestion: classify & extract docs ──────────────── */

export interface IngestionExtraction {
  docType:
    | "receipt"
    | "purchase_request"
    | "damage_claim"
    | "stone_delivery"
    | "shift_report"
    | "invoice"
    | "payment"
    | "withholding_receipt"
    | "production_report"
    | "stock_status"
    | "raw_material_received"
    | "finished_goods_delivery"
    | "purchase_items"
    | "other";
  fields: Record<string, unknown>;
  missing: string[];
  question: string; // next question to ask the worker, in simple English
  complete: boolean;
}

const INGESTION_SCHEMA = `Return STRICT JSON:
{
  "docType": "receipt" | "purchase_request" | "damage_claim" | "stone_delivery" | "shift_report" | "invoice" | "payment" | "withholding_receipt" | "production_report" | "stock_status" | "raw_material_received" | "finished_goods_delivery" | "purchase_items" | "other",
  "fields": { ... extracted fields ... },
  "missing": [field names still needed],
  "question": "ONE short friendly question asking for the most important missing field(s)",
  "complete": boolean
}
Product codes are always one of: ETL15, ETL9, ETL6, 5EL, 3EL, W2EL, 2EL, EC15, EC90, Talk (normalise any spacing/hyphens like "ETL-9" or "ETL 9μ" to these codes; "Micro Talc"/"Talc" -> Talk; "W-2-EL"/"W2-EL"/"Wollega 2-EL" -> W2EL, which is a DIFFERENT product from 2-EL).
Required fields per type:
- receipt: vendor, amount (number, ETB), category, receiptDate (YYYY-MM-DD), client if visible
- purchase_request: title, amount (number, ETB), justification
- damage_claim: quantity (number of damaged bags reported by worker; lotCode only if visible in image or caption)
- stone_delivery: truckPlate, loads (number), qualityGrade ("good"|"fair"|"dark/weathered"), supplier, quarry, driverName if visible
- shift_report: filledSacks (number), bagWeightKg (25 or 40 — the weight in kg of each filled sack), downtimeMinutes (number), shift ("day"|"night"), notes
- invoice: invoiceNumber, client, amount (number, ETB), sacks, bagWeightKg (25 or 40 — the weight in kg of each sold sack), dueDate (YYYY-MM-DD), clientPhone
- payment: invoiceNumber, client, amount (number, ETB), paymentDate (YYYY-MM-DD), method
- withholding_receipt: invoiceNumber, client, amount (number, ETB), receiptDate (YYYY-MM-DD)
- production_report: date (YYYY-MM-DD), fgrNo (the FGR document number), items (array of {product: productCode, tons: number})
- stock_status: month (e.g. "2026-06" or the sheet's month label), rows (array of {code: productCode, description, category ("finished"|"raw"|"packing"), bBalance (opening balance ton), received (ton), sales (ton), unitPrice (ETB), stockTon (ton on hand), etb (stock value ETB)})
- raw_material_received: date (YYYY-MM-DD), supplier, dnNo (delivery-note number), truckPlate, mrvNo (material receiving voucher number), items (array of {material, qty: number})
- finished_goods_delivery: date (YYYY-MM-DD), customer, invoiceNo, paymentType ("cash"|"credit"), deliveryNo, qty (total number), items (array of {product: productCode, qty: number})
- purchase_items: date (YYYY-MM-DD), description, uom, qty (number), supplier, amount (number, ETB), costCenter, purchaser
- other: summary
For the multi-row report types (production_report, stock_status, raw_material_received, finished_goods_delivery) extract EVERY row you can read into the items/rows array. Set complete=true once the header fields and at least one row are present.`;

export async function classifyIngestion(opts: {
  imageBase64?: string;
  imageContentType?: string;
  text?: string;
  priorDraft?: Record<string, unknown>;
  history?: { role: "user" | "assistant"; content: string }[];
}): Promise<IngestionExtraction> {
  const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [];
  if (opts.text) userContent.push({ type: "text", text: opts.text });
  if (opts.priorDraft) {
    userContent.push({
      type: "text",
      text: `Current draft so far (merge new info into it): ${JSON.stringify(opts.priorDraft)}`,
    });
  }
  if (opts.imageBase64) {
    userContent.push({
      type: "image_url",
      image_url: { url: `data:${opts.imageContentType || "image/jpeg"};base64,${opts.imageBase64}`, detail: "low" },
    });
  }
  if (userContent.length === 0) userContent.push({ type: "text", text: "(no content)" });

  const useVision = Boolean(opts.imageBase64);

  try {
    const messages = [
      {
        role: "system",
        content:
          "You are the data-intake assistant for MinTech Ethiopia (a mining company). Workers send you photos, " +
          "typed messages, or the text of an Excel sheet covering receipts, purchase requests, damaged bags, " +
          "truck/stone deliveries, shifts, and the department reports (production, stock status, raw-material " +
          "received, finished-goods delivery, purchased items). Tabular reports may contain many rows — read " +
          "them all. Classify what was sent, extract every field you can read, and ask for whatever is missing. " +
          INGESTION_SCHEMA,
      },
      ...(opts.history || []).slice(-6).map((h) => ({ role: h.role, content: h.content })),
      { role: "user", content: userContent },
    ];

    const params: Record<string, unknown> = {
      model: useVision ? VISION_MODEL : TEXT_MODEL,
      max_tokens: 900,
      messages,
    };
    if (!useVision) params.chat_template_kwargs = { enable_thinking: false };

    const client = useVision ? visionAI() : textAI();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = (await client.chat.completions.create(params as any)) as any;
    const parsed = extractJson(res.choices[0]?.message?.content);
    return {
      docType: parsed.docType || "other",
      fields: parsed.fields || {},
      missing: Array.isArray(parsed.missing) ? parsed.missing : [],
      question: String(parsed.question || "Could you tell me more about what you sent?"),
      complete: !!parsed.complete,
    };
  } catch (e) {
    console.error("classifyIngestion failed:", e);
    return {
      docType: "other",
      fields: {},
      missing: [],
      question: "Sorry, I could not process that. Can you describe what you sent?",
      complete: false,
    };
  }
}
