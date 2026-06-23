const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const API = `https://api.telegram.org/bot${TOKEN}`;

async function call(method: string, payload: Record<string, unknown>) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.ok) console.error(`Telegram ${method} failed:`, JSON.stringify(json));
  return json;
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

export const REPORT_KEYBOARD = {
  keyboard: [
    [{ text: "Report damaged bags" }, { text: "Send receipt" }],
    [{ text: "Purchase request" }, { text: "WHT receipt" }],
    [{ text: "Sales/payment report" }, { text: "Truck delivery" }],
    [{ text: "Shift report" }, { text: "Ask company question" }],
  ],
  resize_keyboard: true,
  one_time_keyboard: false,
};

export async function sendReportMenu(chatId: string | number, text?: string) {
  return sendMessage(
    chatId,
    text || "Choose what you want to report. Send text, a photo, or both; I will ask for any missing fields.",
    { reply_markup: REPORT_KEYBOARD }
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

/** Downloads a Telegram file (photo/document) and returns its bytes. */
export async function downloadTelegramFile(
  fileId: string
): Promise<{ buffer: Buffer; path: string } | null> {
  const info = await call("getFile", { file_id: fileId });
  const path = info?.result?.file_path;
  if (!path) return null;
  const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${path}`);
  if (!res.ok) return null;
  return { buffer: Buffer.from(await res.arrayBuffer()), path };
}
