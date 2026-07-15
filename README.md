# MinTech Ethiopia - Internal System

Mobile-first internal operating system for MinTech Ethiopia, built for Vercel + MongoDB Atlas.

## Modules

| # | Module | Solves | Main interface |
|---|---|---|---|
| M1 | Bag Inventory & Damage Evidence | Problem 1A - bag leakage, fraud, tax over-assessment | Telegram bot intake + dashboard evidence report |
| M2 | Purchase Request Trust Loop | Problem 1B - worker/owner distrust on purchases | Telegram bot intake + owner oversight dashboard |
| M3 | Receivables & Withholding Tracker | Problem 2A - late payments, missing 3% WHT receipts | Telegram WHT/payment intake + accountant report + SMS gateway |
| M4 | Receipt Inbox & Monthly Sales Report | Problem 2B - who paid, who didn't, monthly financials | Telegram bot intake + LLM receipt reading + dashboard report |
| M5 | Owner's Daily Dashboard & Morning Brief | Problem 3 - daily production/sales visibility | Mobile web app (PWA) on Vercel + Telegram push |
| M6 | Truck & Raw-Material Traceability | Problem 4 - which truck brought the bad stone | Telegram gate intake + AI stone scoring + dashboard traceability |

## Routes

- `/` - M5 read-only owner dashboard, trends, exceptions, morning brief and module launch cards.
- `/modules` - six-module operating map matching the implementation table.
- `/bags` - M1 bag lots, stock reconciliation, damage evidence, AI fraud flags and PDF damage register.
- `/purchases` - M2 purchase request visibility and decision history.
- `/receivables` - M3 invoice aging, payments, missing withholding receipts and SMS reminder history.
- `/receipts` - M4 receipt inbox and monthly sales/cash/expense report.
- `/gate` - M6 truck/raw-material traceability and AI stone quality history.
- `/claims/new` and `/shift` redirect back to reporting pages; operational input is handled by Telegram.
- `/chat` - company assistant over live production, sales, receivables, receipts, bag and traceability data.

## Telegram bot access

The bot serves two audiences. `/start` offers exactly two choices, in Amharic:

1. **🧾 ደረሰኝ ያስገቡ** (submit receipt) — for external, non-employee people. On first use the bot asks for a full name and phone number, then accepts only QR-coded receipt photos. External submitters can reach nothing else.
2. **🔐 ለውስጥ ሰራተኛ** (internal employee only) — asks for the employee's full name and password. The password message is deleted from the chat immediately after it is read.

Employees are created at **`/settings`** in the dashboard: full name, password, and one or more positions. The bot menu each employee sees is the union of the capabilities of their positions, so nobody is shown a report they may not file.

| # | Position | May submit |
|---|----------|-----------|
| 1 | Stone quality & weight checker | Truck/stone delivery, shift & weight reports |
| 2 | Daily production reporter | Shift report, daily operations report |
| 3 | Finance reporter (daily & monthly) | Sales/payments **and WHT receipts** |
| 4 | Store keeper | Material counts (PP bags etc.), damaged bags, operations report |
| 5 | WHT receipt submitter | WHT receipts |
| 6 | Tool purchase requester | Purchase requests |
| 7 | HR & customer relations | Customer contact/feedback, price adjustments, employee relations |

Every position additionally gets the daily report, receipts, and the company Q&A. Several people may hold the same position.

Passwords are hashed with scrypt (salted, per-hash cost stored). Wrong guesses lock an account for 15 minutes after 5 attempts, and a chat after 8. Deactivating a user, resetting their password, or forcing sign-out bumps a `sessionEpoch` that invalidates any live Telegram session on the next message, so revocation is immediate without any expiry job. Sessions otherwise persist until `/logout`.

Every bot action — logins, failures, menu choices, permission denials, submissions, reminders — is written to `BotActivity` and shown in the **Bot activity** tab of `/settings`.

## Core Behavior

- The dashboard is for oversight and reporting. Employees submit operational data through the Telegram bot using menu choices, text, photos or both.
- The Telegram bot classifies uploads as receipts, purchase requests, damage claims, WHT receipts, invoices, payments, stone deliveries or shift reports, extracts fields with the LLM, asks follow-up questions when data is missing, and stores the result in the right collection. The report type is fixed by the gated menu choice, so the LLM cannot reclassify a submission into a type the user is not allowed to file.
- Daily reports, material counts and HR reports are stored verbatim (text plus photos) rather than being passed through the LLM.
- Purchase approvals are handled through Telegram inline buttons, and are accepted only from `TELEGRAM_CEO_CHAT_ID`.
- The daily Vercel cron runs at `03:30 UTC` (`06:30 EAT`), recomputes bag balances, detects exceptions, writes the morning brief, sends Telegram to the CEO and broadcasts PWA push notifications.
- A second Vercel cron runs at `05:00 UTC` (`08:00 EAT`) and sends `እባኮትን የቀኑን ሪፖርት ያስገቡ!` to every active employee currently signed into the bot. External receipt submitters are never reminded.
- Claim photos are stored in MongoDB, watermarked client-side, checked with EXIF sanity checks, perceptual hashing and `gpt-4o-mini` image review.
- Gate stone photos are scored by `gpt-4o-mini`; manual gate grades are still supported when no photo or model key is available.
- SMS reminders are optional. If `SMS_GATEWAY_URL` is unset, reminder attempts are recorded as skipped.

## Setup

1. Create a MongoDB Atlas database and set `MONGODB_URI`.
2. Create a Telegram bot and set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CEO_CHAT_ID` and `TELEGRAM_WEBHOOK_SECRET`. Bot users are managed at `/settings`, not via env vars.
3. Set `OPENAI_API_KEY`; this powers the dashboard chatbot, Telegram document reading, damaged-bag checks, stone scoring and morning brief narrative.
4. Generate VAPID keys for PWA push notifications and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
5. Set `CRON_SECRET`, `ADMIN_PASSWORD` and `APP_URL`.
6. Copy `.env.example` to `.env.local` and fill in the values.
7. Install and run:

```bash
npm install
npm run dev
```

Optional demo data:

```bash
npm run seed
```

Deploy to Vercel and point Telegram at the deployed webhook:

```bash
npx vercel link --project min-tech-ethiopia-system
npx vercel env pull .env.local --environment=production
npm run telegram:set-webhook
```

Use `npx vercel link` if your Vercel project name is different. The webhook setup script registers both `message` and `callback_query` updates, so employee reports and owner approval buttons both reach the app. Run it against the Production `APP_URL`; a single Telegram bot can point at only one webhook at a time.

After deployment, sign in to the dashboard and check:

```text
/api/integrations/status
/api/integrations/status?live=1
```

The first endpoint checks that required Vercel env var names are present. The live check also pings MongoDB, OpenAI and Telegram without exposing secret values. If Vercel shows `CRON_SECRETVAPID_PUBLIC_KEY`, split it into two separate variables: `CRON_SECRET` and `VAPID_PUBLIC_KEY`.

## Architecture

- Next.js App Router, TypeScript, Tailwind CSS and Recharts.
- MongoDB/Mongoose models: `BagLot`, `BagEvent`, `DamageClaim`, `StoneDelivery`, `ShiftReport`, `Invoice`, `PurchaseRequest`, `Receipt`, `StoredFile`, `PushSubscription`, `Brief`, `TelegramSession`, `TelegramUser`, `DailyReport`, `HrReport`, `MaterialCount`, `BotActivity`.
- Stored files are served through `/api/files/:id`.
- Auth is a single shared `ADMIN_PASSWORD` cookie for internal pages and APIs; Telegram and cron endpoints use their own secrets.
