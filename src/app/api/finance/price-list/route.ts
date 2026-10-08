import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { monthLabel, priceListItems } from "@/lib/finance-report";

export const dynamic = "force-dynamic";

/**
 * The monthly price list, editable from the dashboard.
 *
 * The same list the finance bot user files with 💲 — products, raw materials
 * and PP bags, one unit price each, plus the dollar rate — and the same row
 * (`monthly_price_lists`, one per month). This exists for the month the bot
 * user could not file it, or filed one figure wrong.
 *
 * A save MERGES into the month's row rather than replacing it: correcting one
 * price on the web must never wipe the other twenty the bot filed.
 */

const MONTH = /^\d{4}-\d{2}$/;

/** GET ?month=YYYY-MM — the items, the month's prices, and who last set them. */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("month") || "";
  const month = MONTH.test(raw) ? raw : monthLabel();
  const [row] = await sql<
    { prices: Record<string, number>; usd_rate: string | null; reported_by: string; source: string; updated_at: string }[]
  >`
    select prices, usd_rate, reported_by, source, updated_at
      from monthly_price_lists where month = ${month}
  `.catch(() => []);
  return NextResponse.json({
    month,
    items: priceListItems(),
    prices: row?.prices ?? {},
    usdRate: row?.usd_rate == null ? null : Number(row.usd_rate),
    reportedBy: row?.reported_by ?? null,
    source: row?.source ?? null,
    updatedAt: row?.updated_at ?? null,
  });
}

/**
 * PUT { month, prices: { key: number | null }, usdRate?: number | null }
 *
 * A number sets that price; null removes it. Keys not on the price list are
 * refused, so a typo cannot add a row the report has no column for.
 */
export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    month?: string;
    prices?: Record<string, number | null>;
    usdRate?: number | null;
  };
  const month = String(body.month || "");
  if (!MONTH.test(month)) return NextResponse.json({ error: "Choose a month (YYYY-MM)." }, { status: 400 });

  const allowed = new Set(priceListItems().map((i) => i.key));
  const changes = Object.entries(body.prices || {});
  const unknown = changes.filter(([k]) => !allowed.has(k)).map(([k]) => k);
  if (unknown.length) {
    return NextResponse.json({ error: `Not on the price list: ${unknown.join(", ")}` }, { status: 400 });
  }
  for (const [k, v] of changes) {
    if (v !== null && (!Number.isFinite(Number(v)) || Number(v) < 0)) {
      return NextResponse.json({ error: `${k}: enter a price of 0 or more.` }, { status: 400 });
    }
  }

  const [existing] = await sql<{ prices: Record<string, number>; usd_rate: string | null }[]>`
    select prices, usd_rate from monthly_price_lists where month = ${month}
  `;
  const prices: Record<string, number> = { ...(existing?.prices ?? {}) };
  for (const [k, v] of changes) {
    if (v === null) delete prices[k];
    else prices[k] = Math.round(Number(v) * 100) / 100;
  }
  const usdRate =
    body.usdRate === undefined
      ? existing?.usd_rate == null
        ? null
        : Number(existing.usd_rate)
      : body.usdRate === null || !(Number(body.usdRate) > 0)
        ? null
        : Number(body.usdRate);

  await sql`
    insert into monthly_price_lists (month, prices, usd_rate, reported_by, source)
    values (${month}, ${sql.json(prices)}, ${usdRate}, 'Dashboard', 'app')
    on conflict (month) do update set
      prices = excluded.prices,
      usd_rate = excluded.usd_rate,
      reported_by = excluded.reported_by,
      source = excluded.source,
      updated_at = now()
  `;
  return NextResponse.json({ ok: true, month, prices, usdRate });
}
