import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/sql";
import { listPurchases, savePurchase, suggestStoreItems } from "@/lib/item-purchases";
import { loadCustomStoreItems } from "@/lib/store-custom";
import { itemLabel } from "@/lib/store-voucher";
import { priceBasisFor } from "@/lib/purchase-price";

export const dynamic = "force-dynamic";

/**
 * GET — every item purchase (Finance → 🛍 Purchase status).
 * GET ?suggest=<name> — the store item that name is, or the nearest few, for
 * the purchase form's item field.
 */
export async function GET(req: NextRequest) {
  await loadCustomStoreItems().catch(() => []);
  const suggest = req.nextUrl.searchParams.get("suggest");
  if (suggest !== null) {
    const { exact, similar } = suggestStoreItems(suggest, 6);
    const view = (it: NonNullable<typeof exact>) => ({ key: it.key, label: itemLabel(it), unit: it.unit });
    return NextResponse.json({ exact: exact ? view(exact) : null, similar: similar.map(view) });
  }
  return NextResponse.json(await listPurchases());
}

/**
 * POST — one purchase from the web form: the pop-up behind ✓ Bought on a
 * purchase request, or a purchase entered directly. With `requestId` the
 * request is marked bought in the same transaction.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || "")) ? new Date(`${body.date}T00:00:00Z`) : null;
  if (!date) return NextResponse.json({ error: "Pick the day it was bought." }, { status: 400 });
  const requestId = body.requestId ? String(body.requestId) : null;
  if (requestId && !isUuid(requestId)) return NextResponse.json({ error: "Unknown purchase request." }, { status: 400 });
  await loadCustomStoreItems().catch(() => []);
  const unit = String(body.unit || "pcs").trim() || "pcs";
  try {
    const { id } = await savePurchase(
      {
        date,
        itemName: String(body.itemName || ""),
        itemKey: body.itemKey ? String(body.itemKey) : null,
        isNew: !!body.isNew,
        qty: Number(body.qty),
        unit,
        basis: priceBasisFor(unit),
        figure: Number(body.figure),
        requestId,
        note: body.note ? String(body.note) : null,
        source: "app",
      },
      String(body.recordedBy || "Dashboard").trim() || "Dashboard"
    );
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "42P01") {
      return NextResponse.json({ error: "Run migration 0042_item_purchases.sql in Supabase first." }, { status: 503 });
    }
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
