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

## Core Behavior

- The dashboard is for oversight and reporting. Employees submit operational data through the Telegram bot using menu choices, text, photos or both.
- The Telegram bot classifies uploads as receipts, purchase requests, damage claims, WHT receipts, invoices, payments, stone deliveries or shift reports, extracts fields with the LLM, asks follow-up questions when data is missing, and stores the result in the right collection.
- Purchase approvals are handled through Telegram inline buttons sent to the owner.
- The daily Vercel cron runs at `03:30 UTC` (`06:30 EAT`), recomputes bag balances, detects exceptions, writes the morning brief, sends Telegram to the CEO and broadcasts PWA push notifications.
- A second Vercel cron runs at `05:00 UTC` (`08:00 EAT`) and sends Telegram report reminders to configured chats and employees who have used the bot.
- Claim photos are stored in MongoDB, watermarked client-side, checked with EXIF sanity checks, perceptual hashing and `gpt-4o-mini` image review.
- Gate stone photos are scored by `gpt-4o-mini`; manual gate grades are still supported when no photo or model key is available.
- SMS reminders are optional. If `SMS_GATEWAY_URL` is unset, reminder attempts are recorded as skipped.

## Setup

1. Create a MongoDB Atlas database and set `MONGODB_URI`.
2. Create a Telegram bot and set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CEO_CHAT_ID`, optional `TELEGRAM_REMINDER_CHAT_IDS` and `TELEGRAM_WEBHOOK_SECRET`.
3. Generate VAPID keys for PWA push notifications and set the `VAPID_*` variables.
4. Copy `.env.example` to `.env.local` and fill in the values.
5. Install and run:

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
APP_URL=https://your-app.vercel.app npm run telegram:set-webhook
```

## Architecture

- Next.js App Router, TypeScript, Tailwind CSS and Recharts.
- MongoDB/Mongoose models: `BagLot`, `BagEvent`, `DamageClaim`, `StoneDelivery`, `ShiftReport`, `Invoice`, `PurchaseRequest`, `Receipt`, `StoredFile`, `PushSubscription`, `Brief`, `TelegramSession`.
- Stored files are served through `/api/files/:id`.
- Auth is a single shared `ADMIN_PASSWORD` cookie for internal pages and APIs; Telegram and cron endpoints use their own secrets.
