import { readFileSync, existsSync } from "fs";

// Points your Telegram bot at the deployed webhook.
// Usage:
//   npx vercel env pull .env.local --environment=production
//   npm run telegram:set-webhook

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const rawLine of readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]]) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[m[1]] = value;
  }
}

const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, APP_URL } = process.env;
const missing = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "APP_URL"].filter(
  (name) => !process.env[name]?.trim()
);
if (missing.length) {
  console.error(`Missing required env var(s): ${missing.join(", ")}`);
  console.error("Set them in Vercel, run `npx vercel env pull .env.local --environment=production`, then retry.");
  process.exit(1);
}

const appUrl = APP_URL.replace(/\/+$/, "");
if (!appUrl.startsWith("https://")) {
  console.error("APP_URL must be the deployed HTTPS URL, for example https://your-app.vercel.app");
  process.exit(1);
}

const url = `${appUrl}/api/telegram/webhook?secret=${encodeURIComponent(TELEGRAM_WEBHOOK_SECRET)}`;
const endpoint = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

const res = await fetch(`${endpoint}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url,
    secret_token: TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  }),
});

const json = await res.json();
console.log(json);
if (!json.ok) process.exit(1);

const infoRes = await fetch(`${endpoint}/getWebhookInfo`, { method: "POST" });
const info = await infoRes.json();
if (info?.result?.url) {
  try {
    const redacted = new URL(info.result.url);
    redacted.searchParams.set("secret", "[redacted]");
    info.result.url = redacted.toString();
  } catch {}
}
console.log(info);
console.log(`Webhook set to ${appUrl}/api/telegram/webhook?secret=[redacted]`);
