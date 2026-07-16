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
      inline_keyboard: [[{ text: "📊 ዳሽቦርዱን ክፈት", url: dashboardUrl }]],
    },
  });
}

/* ─────────────────────────────── Button labels ───────────────────────────── */

export const ENTRY_BUTTONS = {
  receipt: "🧾 ደረሰኝ ያስገቡ",
  internal: "🔐 ለውስጥ ሰራተኛ",
} as const;

export const NAV_BUTTONS = {
  cancel: "❌ ሰርዝ",
  changeReport: "⬅️ የሪፖርት ዓይነት ይቀይሩ",
  back: "⬅️ ተመለስ",
  logout: "🚪 ውጣ",
} as const;

/** First screen after /start — the only two doors into the bot. */
export const ENTRY_KEYBOARD = {
  keyboard: [[{ text: ENTRY_BUTTONS.receipt }], [{ text: ENTRY_BUTTONS.internal }]],
  resize_keyboard: true,
  one_time_keyboard: false,
};

export const BACK_KEYBOARD = {
  keyboard: [[{ text: NAV_BUTTONS.back }]],
  resize_keyboard: true,
  one_time_keyboard: false,
};

export const CHANGE_CANCEL_KEYBOARD = {
  keyboard: [[{ text: NAV_BUTTONS.changeReport }, { text: NAV_BUTTONS.cancel }]],
  resize_keyboard: true,
  one_time_keyboard: false,
};

/** Reply keyboard built from the capabilities the signed-in user actually has. */
export function reportKeyboardFor(buttons: string[]) {
  return {
    keyboard: [...buttons.map((text) => [{ text }]), [{ text: NAV_BUTTONS.logout }]],
    resize_keyboard: true,
    one_time_keyboard: false,
  };
}

export const EXTERNAL_KEYBOARD = {
  keyboard: [[{ text: ENTRY_BUTTONS.receipt }], [{ text: NAV_BUTTONS.back }]],
  resize_keyboard: true,
  one_time_keyboard: false,
};

export async function sendEntryMenu(chatId: string | number, text?: string) {
  return sendMessage(chatId, text || "👋 እንኳን ደህና መጡ! ምን ማድረግ ይፈልጋሉ?", {
    reply_markup: ENTRY_KEYBOARD,
  });
}

export async function sendExternalMenu(chatId: string | number, text?: string) {
  return sendMessage(chatId, text || "🧾 ደረሰኝ ለማስገባት የታችኛውን ቁልፍ ይጫኑ።", {
    reply_markup: EXTERNAL_KEYBOARD,
  });
}

export async function sendReportMenu(chatId: string | number, buttons: string[], text?: string) {
  return sendMessage(chatId, text || "➡️ የሪፖርት ዓይነት ይምረጡ።", {
    reply_markup: reportKeyboardFor(buttons),
  });
}

/** Removes the message that carried the user's password from the chat history. */
export async function deleteMessage(chatId: string | number, messageId: number) {
  return call("deleteMessage", { chat_id: chatId, message_id: messageId });
}

/**
 * Uploads a file to a chat. Unlike every other call here this must be
 * multipart/form-data rather than JSON, because the bytes ride along with it.
 * Telegram caps bot uploads at 50 MB.
 */
export async function sendDocument(
  chatId: string | number,
  file: { buffer: Buffer; filename: string; contentType: string },
  caption?: string
): Promise<TelegramApiResponse<{ message_id: number }>> {
  const token = telegramToken();
  if (!token) {
    const description = "TELEGRAM_BOT_TOKEN is not set.";
    console.error(`Telegram sendDocument failed: ${description}`);
    return { ok: false, description };
  }

  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    if (caption) {
      form.append("caption", caption.slice(0, 1024)); // Telegram's caption limit
      form.append("parse_mode", "HTML");
    }
    form.append(
      "document",
      new Blob([new Uint8Array(file.buffer)], { type: file.contentType }),
      file.filename
    );

    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: "POST",
      body: form,
    });
    const json = (await res.json()) as TelegramApiResponse<{ message_id: number }>;
    if (!json.ok) console.error("Telegram sendDocument failed:", JSON.stringify(json));
    return json;
  } catch (e) {
    const description = e instanceof Error ? e.message : String(e);
    console.error("Telegram sendDocument failed:", description);
    return { ok: false, description };
  }
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
    `🛒 በመጠባበቅ ላይ ያለ የግዢ ጥያቄ፦\n\n<b>${request.title}</b>\n${Math.round(request.amount).toLocaleString()} ETB — ${request.requestedBy}` +
      (request.justification ? `\n${request.justification}` : ""),
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ አጽድቅ", callback_data: `pr:approve:${request.id}` },
            { text: "❌ ውድቅ አድርግ", callback_data: `pr:reject:${request.id}` },
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
