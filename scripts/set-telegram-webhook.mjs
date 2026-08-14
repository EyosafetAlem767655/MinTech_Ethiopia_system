import { readFileSync, existsSync } from "fs";

// Points your Telegram bot at the deployed webhook.
// Usage:
//   npx vercel env pull .env.local --environment=production
//   npm run telegram:set-webhook
//   npm run telegram:set-webhook -- --drop-pending
//
// --drop-pending discards every update Telegram is still holding. Use it once
// after fixing a handler that was timing out: Telegram keeps retrying unanswered
// updates, so without this the old backlog replays against the new deployment.
// It permanently discards genuine unprocessed messages too, so it is opt-in.
const dropPending = process.argv.includes("--drop-pending");

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

// Distinguish "never defined" from "defined but empty". `vercel env pull` writes
// NAME="" for every variable it could not decrypt, which looks completely normal
// in the file — so reporting these as simply "missing" sends you hunting for
// variables that are visibly right there.
const required = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "APP_URL"];
const absent = required.filter((name) => process.env[name] === undefined);
const blank = required.filter((name) => process.env[name] !== undefined && !process.env[name].trim());

if (absent.length || blank.length) {
  if (absent.length) console.error(`Missing env var(s): ${absent.join(", ")}`);
  if (blank.length) {
    console.error(`Present but EMPTY in .env.local: ${blank.join(", ")}`);
    console.error("An empty value means the local file is stale — the values in Vercel are fine.");
  }
  console.error("\nRe-pull them, then retry:");
  console.error("  npx vercel env pull .env.local --environment=production");
  console.error("  npm run telegram:set-webhook -- --drop-pending");
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
    drop_pending_updates: dropPending,
  }),
});

if (dropPending) console.log("Pending updates dropped.");

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
