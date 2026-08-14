import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import sql from "@/lib/sql";
import { envValue, integrationEnvChecks } from "@/lib/env";
import { GEMINI_BASE, GEMINI_MODEL } from "@/lib/llm";
import { BUCKET } from "@/lib/storage";
import { getTelegramBotInfo, getTelegramWebhookInfo } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type LiveStatus = { ok: boolean; error?: string; details?: Record<string, unknown> };

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function redactWebhookUrl(url?: string) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("secret")) parsed.searchParams.set("secret", "[redacted]");
    return parsed.toString();
  } catch {
    return "[configured]";
  }
}

async function checkSupabase(): Promise<LiveStatus> {
  try {
    const [row] = await sql<{ ok: number }[]>`select 1 as ok`;
    return { ok: row?.ok === 1 };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

async function checkAi(): Promise<LiveStatus> {
  const nvidiaKey = envValue("NIVIDA_API_KEY") || envValue("NVIDIA_API_KEY");
  const qwenKey = envValue("QWEN_API");
  const geminiKey = envValue("GEMINI_API_KEY");
  const missing: string[] = [];
  if (!nvidiaKey) missing.push("NIVIDA_API_KEY (text)");
  if (!qwenKey) missing.push("QWEN_API (images)");
  if (!geminiKey) missing.push("GEMINI_API_KEY (receipts)");
  if (missing.length) return { ok: false, error: `Missing: ${missing.join(", ")}` };

  const base = (envValue("NVIDIA_BASE_URL") || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "");
  const [nvidia, gemini] = await Promise.all([
    (async () => {
      try {
        const res = await fetch(`${base}/models`, {
          headers: { Authorization: `Bearer ${nvidiaKey}` },
          cache: "no-store",
        });
        if (!res.ok) return `NVIDIA returned ${res.status}: ${(await res.text()).slice(0, 200)}`;
        return null;
      } catch (e) {
        return `NVIDIA: ${errorMessage(e)}`;
      }
    })(),
    checkGeminiModel(geminiKey),
  ]);

  const errors = [nvidia, gemini].filter(Boolean) as string[];
  return {
    ok: errors.length === 0,
    error: errors.length ? errors.join(" | ") : undefined,
    details: {
      textConfigured: true,
      imagesConfigured: Boolean(qwenKey),
      receiptModel: GEMINI_MODEL,
      receiptsOk: gemini === null,
    },
  };
}

/**
 * Live check that the receipt model is actually callable with this key. A wrong
 * GEMINI_MODEL returns 404 and a rejected key returns 403 — both of which used
 * to surface only as a blank receipt in Telegram with nothing on this page.
 */
async function checkGeminiModel(key: string): Promise<string | null> {
  try {
    const res = await fetch(`${GEMINI_BASE}/models/${GEMINI_MODEL}`, {
      headers: { "x-goog-api-key": key },
      cache: "no-store",
    });
    if (res.ok) return null;
    const body = (await res.text().catch(() => "")).slice(0, 200);
    if (res.status === 404) return `Gemini model "${GEMINI_MODEL}" not available for this key (404)`;
    return `Gemini returned ${res.status}: ${body}`;
  } catch (e) {
    return `Gemini: ${errorMessage(e)}`;
  }
}

/** The receipt photos are useless if the bucket is unreachable, so check it too. */
async function checkStorage(): Promise<LiveStatus> {
  const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
  const key = envValue("SUPABASE_SECRET_KEY");
  if (!url || !key) {
    return { ok: false, error: "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY" };
  }
  try {
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.storage.getBucket(BUCKET);
    if (error) return { ok: false, error: `Bucket "${BUCKET}": ${error.message}` };
    return { ok: true, details: { bucket: BUCKET, public: data?.public ?? false } };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

async function checkTelegram(): Promise<LiveStatus> {
  const [bot, webhook] = await Promise.all([getTelegramBotInfo(), getTelegramWebhookInfo()]);
  if (!bot.ok || !webhook.ok) {
    return {
      ok: false,
      error: [bot.description, webhook.description].filter(Boolean).join(" | ") || "Telegram API check failed.",
    };
  }

  const info = webhook.result || {};
  const allowedUpdates = info.allowed_updates || [];
  const callbackUpdatesEnabled = allowedUpdates.length === 0 || allowedUpdates.includes("callback_query");
  const messageUpdatesEnabled = allowedUpdates.length === 0 || allowedUpdates.includes("message");
  const appUrl = envValue("APP_URL").replace(/\/+$/, "");
  const webhookUrl = redactWebhookUrl(info.url);
  const pointsToApp = appUrl ? webhookUrl.startsWith(appUrl) : false;

  return {
    ok: Boolean(info.url) && callbackUpdatesEnabled && messageUpdatesEnabled && pointsToApp,
    details: {
      botUsername: bot.result?.username,
      webhookUrl,
      pendingUpdateCount: info.pending_update_count || 0,
      lastErrorMessage: info.last_error_message || null,
      allowedUpdates,
      pointsToApp,
      messageUpdatesEnabled,
      callbackUpdatesEnabled,
    },
  };
}

export async function GET(req: NextRequest) {
  const live = req.nextUrl.searchParams.get("live") === "1";
  const checks = integrationEnvChecks();
  const liveChecks: Record<string, LiveStatus> = {};

  if (live) {
    liveChecks.supabase = await checkSupabase();
    liveChecks.ai = await checkAi();
    liveChecks.storage = await checkStorage();
    liveChecks.telegram = await checkTelegram();
  }

  const configured = Object.values(checks).every((check) => check.configured && check.warnings.length === 0);
  const liveOk = !live || Object.values(liveChecks).every((check) => check.ok);

  return NextResponse.json({
    ok: configured && liveOk,
    live,
    checkedAt: new Date().toISOString(),
    checks,
    liveChecks,
  });
}
