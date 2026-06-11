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
