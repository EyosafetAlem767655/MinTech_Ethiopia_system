import OpenAI from "openai";
import { envValue, requireEnv } from "@/lib/env";

let _client: OpenAI | null = null;
let _clientKey = "";

export function isOpenAIConfigured(): boolean {
  return envValue("OPENAI_API_KEY").length > 0;
}

export function openai(): OpenAI {
  const apiKey = requireEnv("OPENAI_API_KEY", "AI chat, Telegram document reading, photo checks and morning brief generation");
  if (!_client || _clientKey !== apiKey) {
    _client = new OpenAI({ apiKey });
    _clientKey = apiKey;
  }
  return _client;
}

export const VISION_MODEL = "gpt-4o-mini";
export const TEXT_MODEL = "gpt-4o-mini";

/* ───────────────────── Claim photo fraud / validity check ─────────────────── */

export interface PhotoVerdict {
  bag_visible: boolean;
  matches_bag_type: boolean;
  damage_visible: boolean;
  damage_severity: "none" | "minor" | "moderate" | "severe";
  suspicious: boolean;
  suspicion_reasons: string[];
  notes: string;
}

const PHOTO_VERDICT_FALLBACK: PhotoVerdict = {
  bag_visible: false,
  matches_bag_type: false,
  damage_visible: false,
  damage_severity: "none",
  suspicious: true,
  suspicion_reasons: ["ai_check_failed"],
  notes: "Automatic check failed; manual review required.",
};

export async function checkClaimPhoto(
  imageBase64: string,
  contentType: string,
  bagType: string
): Promise<PhotoVerdict> {
  try {
    const res = await openai().chat.completions.create({
      model: VISION_MODEL,
      response_format: { type: "json_object" },
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content:
            "You are a quality-control inspector for a mining company's bag damage claims. " +
            "Inspect the photo and answer STRICTLY as JSON with these keys: " +
            "bag_visible (boolean), matches_bag_type (boolean — does the bag look like the registered type?), " +
            "damage_visible (boolean), damage_severity ('none'|'minor'|'moderate'|'severe'), " +
            "suspicious (boolean), suspicion_reasons (array of strings from: 'screenshot', 'photo_of_screen', " +
            "'heavy_blur', 'stock_photo_look', 'no_bag', 'other'), notes (short string). " +
            "Mark suspicious=true if the image looks like a screenshot (UI elements, status bars, crops), " +
            "a photo of another screen (moiré patterns, glare, pixels), or is too blurred to verify damage.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Registered bag type for this lot: "${bagType}". Inspect this damage-claim photo.` },
            { type: "image_url", image_url: { url: `data:${contentType};base64,${imageBase64}`, detail: "low" } },
          ],
        },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
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
    };
  } catch (e) {
    console.error("checkClaimPhoto failed:", e);
    return PHOTO_VERDICT_FALLBACK;
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
    const res = await openai().chat.completions.create({
      model: VISION_MODEL,
      response_format: { type: "json_object" },
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
    const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
    const qualityGrade = ["good", "fair", "dark/weathered"].includes(parsed.qualityGrade)
      ? parsed.qualityGrade
      : "fair";
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

export async function writeBriefNarrative(structured: Record<string, unknown>): Promise<string> {
  try {
    const res = await openai().chat.completions.create({
      model: TEXT_MODEL,
      max_tokens: 500,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            "You write the CEO morning brief for MinTech Ethiopia, a mining company. " +
            "You are given structured data computed directly from the database. " +
            "RULES: Never invent, round differently, or extrapolate any number — quote figures exactly as given. " +
            "Lead with exceptions (most urgent first), then a crisp narrative of yesterday. " +
            "Plain text only, no markdown headers. 4–7 short sentences. Confident, factual tone. " +
            "Currency is ETB. Address it to Mr. Anteneh implicitly (no greeting needed).",
        },
        { role: "user", content: JSON.stringify(structured) },
      ],
    });
    return res.choices[0]?.message?.content?.trim() || "";
  } catch (e) {
    console.error("writeBriefNarrative failed:", e);
    return "";
  }
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
    const res = await openai().chat.completions.create({
      model: VISION_MODEL,
      response_format: { type: "json_object" },
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
    const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
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
    | "other";
  fields: Record<string, unknown>;
  missing: string[];
  question: string; // next question to ask the worker, in simple English
  complete: boolean;
}

const INGESTION_SCHEMA = `Return STRICT JSON:
{
  "docType": "receipt" | "purchase_request" | "damage_claim" | "stone_delivery" | "shift_report" | "invoice" | "payment" | "withholding_receipt" | "other",
  "fields": { ... extracted fields ... },
  "missing": [field names still needed],
  "question": "ONE short friendly question asking for the most important missing field(s)",
  "complete": boolean
}
Required fields per type:
- receipt: vendor, amount (number, ETB), category, receiptDate (YYYY-MM-DD), client if visible
- purchase_request: title, amount (number, ETB), justification
- damage_claim: lotCode, quantity (number of damaged bags)
- stone_delivery: truckPlate, loads (number), qualityGrade ("good"|"fair"|"dark/weathered"), supplier, quarry, driverName if visible
- shift_report: filledSacks (number), downtimeMinutes (number), shift ("day"|"night"), notes
- invoice: invoiceNumber, client, amount (number, ETB), sacks, dueDate (YYYY-MM-DD), clientPhone
- payment: invoiceNumber, client, amount (number, ETB), paymentDate (YYYY-MM-DD), method
- withholding_receipt: invoiceNumber, client, amount (number, ETB), receiptDate (YYYY-MM-DD)
- other: summary`;

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

  try {
    const res = await openai().chat.completions.create({
      model: VISION_MODEL,
      response_format: { type: "json_object" },
      max_tokens: 500,
      messages: [
        {
          role: "system",
          content:
            "You are the data-intake assistant for MinTech Ethiopia (a mining company). Workers send you photos " +
            "of receipts, purchase requests, damaged bags, and short messages about truck deliveries and shifts. " +
            "Classify what was sent, extract every field you can read, and ask for whatever is missing. " +
            INGESTION_SCHEMA,
        },
        ...(opts.history || []).slice(-6).map((h) => ({ role: h.role, content: h.content } as const)),
        { role: "user", content: userContent },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
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
