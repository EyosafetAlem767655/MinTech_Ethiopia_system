import { envValue } from "@/lib/env";

export interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

function telegramToken() {
  return envValue("TELEGRAM_BOT_TOKEN");
}

async function call<T = unknown>(
  method: string,
  payload: Record<string, unknown> = {}
): Promise<TelegramApiResponse<T>> {
  const token = telegramToken();
  if (!token) {
    const description = "TELEGRAM_BOT_TOKEN is not set.";
    console.error(`Telegram ${method} failed: ${description}`);
    return { ok: false, description };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as TelegramApiResponse<T>;
    if (!json.ok) console.error(`Telegram ${method} failed:`, JSON.stringify(json));
    return json;
  } catch (e) {
    const description = e instanceof Error ? e.message : String(e);
    console.error(`Telegram ${method} failed:`, description);
    return { ok: false, description };
  }
}

export async function sendMessage(
  chatId: string | number,
  text: string,
  extra: Record<string, unknown> = {}
) {
  return call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

export async function sendBriefMessage(chatId: string | number, text: string, dashboardUrl: string) {
  return sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: [[{ text: "📊 Open Dashboard", url: dashboardUrl }]],
    },
  });
}

export const REPORT_BUTTONS = {
  damage: "🛡️ Damage bags",
  receipt: "🧾 Receipt",
  purchase: "🛒 Purchase request",
  wht: "📄 WHT receipt",
  sales: "💵 Sales/payment",
  truck: "🚚 Truck delivery",
  shift: "🏭 Shift report",
  ops: "📊 Daily ops report",
  question: "🤖 Ask company question",
} as const;

export const REPORT_KEYBOARD = {
  keyboard: [
    [{ text: REPORT_BUTTONS.damage }],
    [{ text: REPORT_BUTTONS.receipt }],
    [{ text: REPORT_BUTTONS.purchase }],
    [{ text: REPORT_BUTTONS.wht }],
    [{ text: REPORT_BUTTONS.sales }],
    [{ text: REPORT_BUTTONS.truck }],
    [{ text: REPORT_BUTTONS.shift }],
    [{ text: REPORT_BUTTONS.ops }],
    [{ text: REPORT_BUTTONS.question }],
  ],
  resize_keyboard: true,
  one_time_keyboard: false,
};

export const INPUT_TYPE_KEYBOARD = {
  keyboard: [
    [{ text: "📝 Type details" }],
    [{ text: "📷 Send photo" }],
    [{ text: "🖼️ Photo + caption" }],
    [{ text: "⬅️ Change report" }, { text: "❌ Cancel" }],
  ],
  resize_keyboard: true,
  one_time_keyboard: false,
};

export async function sendReportMenu(chatId: string | number, text?: string) {
  return sendMessage(
    chatId,
    text || "Choose the report section.",
    { reply_markup: REPORT_KEYBOARD }
  );
}

export async function sendInputTypeMenu(chatId: string | number, reportLabel: string, hint?: string) {
  return sendMessage(
    chatId,
    `<b>${reportLabel}</b>\nChoose how you want to submit it.` + (hint ? `\n\n${hint}` : ""),
    { reply_markup: INPUT_TYPE_KEYBOARD }
  );
}

export async function answerCallbackQuery(callbackQueryId: string, text: string) {
  return call("answerCallbackQuery", { callback_query_id: callbackQueryId, text, show_alert: false });
}

export async function sendPurchaseDecisionRequest(
  chatId: string | number,
  request: { id: string; title: string; amount: number; requestedBy: string; justification?: string }
) {
  return sendMessage(
    chatId,
    `Purchase request pending\n\n<b>${request.title}</b>\nETB ${Math.round(request.amount).toLocaleString()} by ${request.requestedBy}` +
      (request.justification ? `\n${request.justification}` : ""),
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Approve", callback_data: `pr:approve:${request.id}` },
            { text: "Reject", callback_data: `pr:reject:${request.id}` },
          ],
        ],
      },
    }
  );
}

export async function getTelegramBotInfo() {
  return call<{ id: number; is_bot: boolean; first_name: string; username?: string }>("getMe");
}

export async function getTelegramWebhookInfo() {
  return call<{
    url?: string;
    has_custom_certificate?: boolean;
    pending_update_count?: number;
    last_error_date?: number;
    last_error_message?: string;
    max_connections?: number;
    allowed_updates?: string[];
  }>("getWebhookInfo");
}

/** Downloads a Telegram file (photo/document) and returns its bytes. */
export async function downloadTelegramFile(
  fileId: string
): Promise<{ buffer: Buffer; path: string } | null> {
  const token = telegramToken();
  if (!token) {
    console.error("downloadTelegramFile failed: TELEGRAM_BOT_TOKEN is not set.");
    return null;
  }

  const info = await call<{ file_path?: string }>("getFile", { file_id: fileId });
  const path = info?.result?.file_path;
  if (!path) return null;
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${path}`);
  if (!res.ok) return null;
  return { buffer: Buffer.from(await res.arrayBuffer()), path };
}
