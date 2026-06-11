# MinTech Ethiopia — Internal System

Mobile-first internal PWA for **MinTech Ethiopia** (mining company), built to run entirely on
**Vercel Hobby** + **MongoDB Atlas M0 (free)**. Brand: reddish brown & white.

Two modules in one repo:

1. **Owner's Daily Dashboard & Morning Brief** (Module 5) — for Mr. Anteneh, the CEO
2. **PB Bag Control System** (Module 1) — claims-with-photo-proof bag tracking

---

## What it does

### ☀️ Morning Brief (6:30 AM Ethiopia time, every day)
- One **Vercel Cron** run at `03:30 UTC` (= 06:30 EAT) — fits the Hobby tier's one-cron-per-day limit by design.
- The job: recomputes every lot balance → pulls yesterday's numbers straight from MongoDB →
  detects exceptions → asks the LLM for the narrative (**numbers come from queries; words come
  from the model; figures are never hallucinated**) → sends a **Telegram message** to the CEO and a
  **PWA push notification** to every subscribed device.
- The message leads with **exceptions first** ("bag damage rate 3× the monthly average", "Client X
  crossed 30 days overdue", "truck ET-3-A12345's load scored dark/weathered at the gate"), then
  **yesterday in five lines**, then the AI narrative. Tapping it opens the dashboard.

### 📊 Dashboard (`/`)
- Installable, mobile-first PWA — no app store, no updates to install, works on any phone.
- Yesterday's numbers: truckloads received, sacks produced, sacks sold, revenue invoiced,
  cash collected, damaged bags claimed & verified.
- Trends with **Recharts**: 7/30/90-day charts for production, sales & collections,
  best/worst days, month-on-month comparison.
- Money: receivables aging, missing withholding receipts, purchase requests —
  **Mr. Anteneh approves purchase requests right there**.

### ✈️ Telegram bot
- Workers send photos of receipts, purchase requests, damaged bags, plus delivery/shift info.
- The LLM classifies each upload, extracts fields, asks follow-up questions for missing
  metadata, and files everything in the correct collection.
- Any plain question becomes a **company chatbot** conversation with full data access
  (same engine as `/chat` in the app).
- `/brief` resends the latest morning brief; `/cancel` resets an in-progress upload.

### 🛡 PB Bag Control (`/bags`, `/claims/new`)
- Lot registration: supplier, quantity, bag type, photos of the stacked lot, delivery note №.
- Running balance per lot: received / filled / damaged-with-proof / in stock — any gap is an
  automatic **red flag** with the names of everyone who handled the lot.
- Damage claims (`/claims/new`): **in-app camera only** (`capture="environment"`, no gallery),
  GPS + timestamp + device id + worker identity recorded, **visible watermark** burned in.
- Telegram-submitted claims are **auto-flagged for supervisor co-signing**.
- Every claim photo goes to **gpt-4o-mini** with a structured prompt returning JSON:
  bag visible? matches registered bag type? damage visible? severity? suspicious
  (screenshot / photo of a screen / heavy blur)?
- **Perceptual hash** (dHash) on every image, compared against **all prior claims** —
  duplicates and resubmissions are caught. **EXIF/metadata sanity checks** run on every photo.
- Daily job recomputes every lot balance; statistical **tripwires** by worker, shift and
  supplier lot.
- Verified damage requires a **disposal action**: returned to supplier / destroyed with photo /
  sold as scrap with amount logged.
- **PDF damage & loss register** export (timestamped, with lot, date, photo evidence refs,
  AI verdict, supervisor sign-off) for the revenue authority — `/api/export/damage-register`.

### 🏭 End-of-shift form (`/shift`)
60-second form for the shift supervisor: filled sacks, downtime, notes. Closes the data gap the
other modules don't cover.

---

## Setup (15 minutes)

### 1. MongoDB Atlas (free)
Create an M0 cluster → Database Access user → Network Access `0.0.0.0/0` (Vercel has no fixed IP)
→ copy the connection string.

### 2. Telegram bot
1. Message **@BotFather** → `/newbot` → copy the token.
2. Message your new bot once, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `message.chat.id`
   from Mr. Anteneh's chat → that's `TELEGRAM_CEO_CHAT_ID`.

### 3. VAPID keys (web push)
```bash
npx web-push generate-vapid-keys
```

### 4. Environment variables
Copy `.env.example` → fill in every value → add **all of them** in
*Vercel → Project → Settings → Environment Variables*.

### 5. Deploy
Push to GitHub and import the repo in Vercel. The `vercel.json` cron
(`30 3 * * *` = 06:30 Ethiopia time) registers automatically.

### 6. Point Telegram at the deployment
```bash
APP_URL=https://your-app.vercel.app npm run telegram:set-webhook
```

### 7. (Optional) demo data
```bash
npm run seed          # 90 days of realistic data, exceptions included
```
Then trigger the first brief manually:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/cron/daily-brief
```

### Local development
```bash
npm install
cp .env.example .env.local   # fill it in
npm run dev
```

---

## Architecture notes

- **Next.js 14 App Router**, TypeScript, Tailwind (brand: `clay` reddish-brown scale), Recharts.
- **Mongoose** models: `BagLot`, `BagEvent`, `DamageClaim`, `StoneDelivery`, `ShiftReport`,
  `Invoice`, `PurchaseRequest`, `Receipt`, `StoredFile`, `PushSubscription`, `Brief`,
  `TelegramSession`.
- Photos are stored in MongoDB (`StoredFile`) and served via `/api/files/:id` — no extra
  storage service needed on the free tiers.
- Auth: single shared password (`ADMIN_PASSWORD`) → HMAC cookie via middleware. Telegram and
  cron routes authenticate with their own secrets.
- LLM: OpenAI `gpt-4o-mini` for photo inspection, ingestion classification, the chatbot
  (tool-calling over live aggregations) and the brief narrative.
