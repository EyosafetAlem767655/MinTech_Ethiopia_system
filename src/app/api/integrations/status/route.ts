import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { envValue, integrationEnvChecks } from "@/lib/env";
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

async function checkOpenAI(): Promise<LiveStatus> {
  const apiKey = envValue("OPENAI_API_KEY");
  if (!apiKey) return { ok: false, error: "OPENAI_API_KEY is missing." };

  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `OpenAI returned ${res.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true };
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
    liveChecks.openai = await checkOpenAI();
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
