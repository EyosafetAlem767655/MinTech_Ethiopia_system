// Points your Telegram bot at the deployed webhook.
// Usage: APP_URL=https://your-app.vercel.app npm run telegram:set-webhook
import { readFileSync, existsSync } from "fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, APP_URL } = process.env;
if (!TELEGRAM_BOT_TOKEN || !APP_URL) {
  console.error("Need TELEGRAM_BOT_TOKEN and APP_URL (env or .env.local).");
  process.exit(1);
}

const url = `${APP_URL}/api/telegram/webhook`;
const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url,
    secret_token: TELEGRAM_WEBHOOK_SECRET || undefined,
    allowed_updates: ["message"],
  }),
});
console.log(await res.json());
console.log(`Webhook set to ${url}`);
