import sql from "@/lib/sql";
import { envValue } from "@/lib/env";
import {
  GEMINI_MODEL,
  NEMOTRON_VISION_MODEL,
  QWEN_ON_NVIDIA,
  TEXT_MODEL,
  VISION_MODEL,
  geminiAttempt,
  nvidiaVisionAI,
  textAI,
  visionAI,
} from "@/lib/llm";
import { stripReasoning } from "@/lib/llm-crossing";
import { checkSchema } from "@/lib/schema-check";
import { smsDiagnostics } from "@/lib/sms";
import { vapidSubject } from "@/lib/push";

/**
 * One test per outside service this system depends on.
 *
 * Each is a REAL, minimal call — "reply OK", read a 1-pixel image, ask the bot
 * who it is — never a check that a variable is set. The receipt reader failed
 * on a Qwen key that was set and simply wrong, and nothing short of using the
 * key would have said so before a person holding receipts found out.
 *
 * Every provider is called DIRECTLY, never through geminiGenerate: that one
 * falls back from provider to provider by design, which is right for a receipt
 * and wrong for a test — a dead Gemini would pass as "OK (answered by Nemotron)".
 *
 * Run from Settings → Errors (one button each, or all), and once a day by the
 * purge-photos cron, which records it as the "api-health" job: a failure is
 * messaged to the admins like any failed job.
 */

export type HealthKey =
  | "database"
  | "schema"
  | "gemini"
  | "nemotron_text"
  | "nemotron_vision"
  | "qwen_vision"
  | "telegram"
  | "sms"
  | "push";

export interface HealthResult {
  key: HealthKey;
  label: string;
  ok: boolean;
  /** Not configured at all — reported, but not counted as a failure. */
  skipped?: boolean;
  ms: number;
  /** What answered, or why it did not. */
  detail: string;
}

export const HEALTH_LABEL: Record<HealthKey, string> = {
  database: "Database (Supabase)",
  schema: "Database schema",
  gemini: "Gemini (receipts, chat)",
  nemotron_text: "Nemotron text (NVIDIA)",
  nemotron_vision: "Nemotron vision (NVIDIA)",
  qwen_vision: "Qwen vision",
  telegram: "Telegram bot",
  sms: "SMS gateway (httpSMS)",
  push: "Web push (VAPID)",
};

export const HEALTH_KEYS = Object.keys(HEALTH_LABEL) as HealthKey[];

export function isHealthKey(v: unknown): v is HealthKey {
  return typeof v === "string" && v in HEALTH_LABEL;
}

/** A 1×1 red PNG: the smallest thing a vision model can be asked to see. */
const RED_PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const TIMEOUT_MS = 30_000;

const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 300);

async function timed(
  key: HealthKey,
  work: () => Promise<{ ok: boolean; detail: string; skipped?: boolean }>
): Promise<HealthResult> {
  const started = Date.now();
  let out: { ok: boolean; detail: string; skipped?: boolean };
  try {
    out = await Promise.race([
      work(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no answer in ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)),
    ]);
  } catch (e) {
    out = { ok: false, detail: short(e) };
  }
  return { key, label: HEALTH_LABEL[key], ms: Date.now() - started, ...out };
}

/** An OpenAI-compatible model: ask for one word back, with or without the pixel. */
async function askOpenAi(
  client: () => import("openai").default | null,
  model: string,
  withImage: boolean,
  reasoning = false
): Promise<{ ok: boolean; detail: string; skipped?: boolean }> {
  const c = client();
  if (!c) return { ok: false, skipped: true, detail: "no API key set" };
  const content = withImage
    ? [
        { type: "text", text: "What colour is this image? Answer with one word." },
        { type: "image_url", image_url: { url: `data:image/png;base64,${RED_PIXEL}` } },
      ]
    : "Reply with the single word OK.";
  const res = await c.chat.completions.create({
    model,
    messages: [{ role: "user", content }] as never,
    temperature: 0,
    max_tokens: reasoning ? 2048 : 20,
    ...(reasoning ? { reasoning_budget: 256 } : {}),
  } as never);
  const raw = String((res as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content || "");
  const text = stripReasoning(raw).trim();
  if (!text) return { ok: false, detail: `${model} answered with nothing` };
  return { ok: true, detail: `${model} → "${text.slice(0, 40)}"` };
}

const CHECKS: Record<HealthKey, () => Promise<{ ok: boolean; detail: string; skipped?: boolean }>> = {
  database: async () => {
    const [r] = await sql<{ v: string; size: string }[]>`
      select version() as v, pg_size_pretty(pg_database_size(current_database())) as size
    `;
    return { ok: true, detail: `${String(r.v).split(" ").slice(0, 2).join(" ")} · ${r.size}` };
  },

  schema: async () => {
    const r = await checkSchema();
    if (r.error) return { ok: false, detail: r.error };
    if (r.ok) return { ok: true, detail: "every table and column the code writes to is there" };
    const files = [...new Set([...r.missingTables.map((t) => t.migration), ...r.missing.map((m) => m.migration)])];
    return { ok: false, detail: `missing ${r.missing.length + r.missingTables.length} — run ${files.join(", ")}` };
  },

  gemini: async () => {
    if (!envValue("GEMINI_API_KEY")) return { ok: false, skipped: true, detail: "GEMINI_API_KEY not set" };
    const res = await geminiAttempt(
      [
        {
          role: "user",
          parts: [{ inline_data: { mime_type: "image/png", data: RED_PIXEL } }, { text: "What colour is this image? One word." }],
        },
      ],
      { model: GEMINI_MODEL, maxOutputTokens: 20, timeoutMs: 25_000 }
    );
    return res.ok
      ? { ok: true, detail: `${res.model || GEMINI_MODEL} → "${res.text.trim().slice(0, 40)}"` }
      : { ok: false, detail: `${res.model || GEMINI_MODEL}: ${res.error}` };
  },

  nemotron_text: () => askOpenAi(() => (envValue("NIVIDA_API_KEY") || envValue("NVIDIA_API_KEY") ? textAI() : null), TEXT_MODEL, false),

  nemotron_vision: () => askOpenAi(nvidiaVisionAI, NEMOTRON_VISION_MODEL, true, true),

  qwen_vision: async () => {
    const r = await askOpenAi(() => (envValue("QWEN_API") ? visionAI() : null), VISION_MODEL, true);
    return { ...r, detail: `${r.detail}${QWEN_ON_NVIDIA ? " (via NVIDIA)" : ""}` };
  },

  telegram: async () => {
    const token = envValue("TELEGRAM_BOT_TOKEN");
    if (!token) return { ok: false, skipped: true, detail: "TELEGRAM_BOT_TOKEN not set" };
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { username?: string }; description?: string };
    return body.ok ? { ok: true, detail: `@${body.result?.username}` } : { ok: false, detail: body.description || `HTTP ${res.status}` };
  },

  // Configuration only. Proving the gateway end to end means sending a text,
  // which costs money and lands on a real phone — that stays a manual button
  // on the WHT tab ("send a test SMS").
  sms: async () => {
    const d = smsDiagnostics();
    if (!d.configured) return { ok: false, skipped: true, detail: "HTTPSMS_API_KEY / PHONE_NUMBER not set" };
    return { ok: true, detail: `configured · sender ${d.sender ?? "?"} · key …${d.keyTail ?? ""} (not sent — use the WHT tab to send a test)` };
  },

  push: async () => {
    if (!envValue("VAPID_PUBLIC_KEY") || !envValue("VAPID_PRIVATE_KEY")) {
      return { ok: false, skipped: true, detail: "VAPID keys not set" };
    }
    const webpush = (await import("web-push")).default;
    webpush.setVapidDetails(vapidSubject(), envValue("VAPID_PUBLIC_KEY"), envValue("VAPID_PRIVATE_KEY"));
    return { ok: true, detail: `keys valid · subject ${vapidSubject()}` };
  },
};

export function runHealthCheck(key: HealthKey): Promise<HealthResult> {
  return timed(key, CHECKS[key]);
}

/** Every check, side by side. Failures never stop the others. */
export async function runAllHealthChecks(): Promise<HealthResult[]> {
  return Promise.all(HEALTH_KEYS.map((k) => runHealthCheck(k)));
}

/** "2 of 9 failing: Qwen vision, SMS" — for the job row and the admin message. */
export function healthSummary(results: HealthResult[]): string {
  const failed = results.filter((r) => !r.ok && !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  return failed.length === 0
    ? `all ${results.length - skipped.length} checks passed${skipped.length ? ` · ${skipped.length} not configured` : ""}`
    : `${failed.length} of ${results.length} failing: ${failed.map((r) => `${r.label} (${r.detail.slice(0, 120)})`).join("; ")}`;
}
