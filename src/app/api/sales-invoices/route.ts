import { NextRequest, NextResponse } from "next/server";
import sql, { isUuid } from "@/lib/sql";
import { withSalesFallback } from "@/lib/sales-sql";
import { customerKey, isTin } from "@/lib/sales-tin";

export const dynamic = "force-dynamic";

/**
 * GET — the sales sheet, one row per sale, newest first. `?from=&to=`
 * (YYYY-MM-DD, inclusive) narrows it; otherwise the latest 3000.
 *
 * No photograph anywhere in this: a sale's receipts are read once by the bot
 * and never stored or referenced, so the columns below are the whole record.
 */
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from") || "";
  const to = req.nextUrl.searchParams.get("to") || "";
  const day = /^\d{4}-\d{2}-\d{2}$/;
  try {
    const rows = await withSalesFallback((legacy) => sql<Record<string, unknown>[]>`
      select id as _id, date, date_label as "dateLabel", customer,
             ${legacy ? sql`null::text` : sql`tin`} as tin,
             invoice_cash as "invoiceCash", invoice_credit as "invoiceCredit",
             qty, delivery_no as "deliveryNo", products, bank,
             ${legacy ? sql`null::jsonb` : sql`banks`} as banks,
             reported_by as "reportedBy", created_at as "createdAt"
        from sales_invoices
       where true
         ${day.test(from) ? sql`and date_label >= ${from}` : sql``}
         ${day.test(to) ? sql`and date_label <= ${to}` : sql``}
       order by date desc, created_at desc
       limit 3000
    `);
    const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);
    return NextResponse.json(
      rows.map((r) => ({
        ...r,
        invoiceCash: num(r.invoiceCash),
        invoiceCredit: num(r.invoiceCredit),
        qty: num(r.qty),
        products: (r.products as Record<string, number>) || {},
        banks: Array.isArray(r.banks) ? r.banks : [],
      }))
    );
  } catch (e) {
    // The table arrives in 0027 — an empty panel, never a 500.
    if ((e as { code?: string })?.code === "42P01") return NextResponse.json([]);
    throw e;
  }
}

/**
 * PATCH — correct a sale's customer name and/or TIN. Nothing else.
 *
 * Body: { id, customer?, tin?, applyToSameName? }. Money, tonnes, banks and
 * dates are deliberately not editable here — those come from the receipts, and
 * a correction to them goes through Settings → Submissions, where it is logged.
 *
 * `applyToSameName` (the default) sets the TIN on every sale filed under the
 * same name, which is how a month of old sales gets its TIN in one go. A sale
 * that already carries a DIFFERENT TIN is not overwritten: two buyers can share
 * a name.
 */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    customer?: string;
    tin?: string | null;
    applyToSameName?: boolean;
  };
  if (!body.id || !isUuid(body.id)) return NextResponse.json({ error: "id required" }, { status: 400 });

  const customer = body.customer === undefined ? undefined : String(body.customer).trim();
  if (customer !== undefined && !customer) {
    return NextResponse.json({ error: "Customer name cannot be empty." }, { status: 400 });
  }
  let tin: string | null | undefined;
  if (body.tin !== undefined) {
    const t = String(body.tin ?? "").replace(/[\s\-.]/g, "");
    if (t && !isTin(t)) return NextResponse.json({ error: "A TIN is exactly 10 digits." }, { status: 400 });
    tin = t || null;
  }
  if (customer === undefined && tin === undefined) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  try {
    const [before] = await sql<{ customer: string; tin: string | null }[]>`
      select customer, tin from sales_invoices where id = ${body.id!}
    `;
    if (!before) return NextResponse.json({ error: "Sale not found." }, { status: 404 });

    const updated = await sql`
      update sales_invoices set
        customer = ${customer ?? before.customer},
        tin = ${tin === undefined ? before.tin : tin},
        updated_at = now()
       where id = ${body.id!}
    `;
    let others = 0;
    if (body.applyToSameName !== false && tin) {
      // Matched on the name as it was AND as it now is, so renaming and
      // setting the TIN in one save still reaches the customer's other sales.
      const keys = [...new Set([customerKey(before.customer), customerKey(customer ?? before.customer)])];
      const res = await sql`
        update sales_invoices set tin = ${tin}, updated_at = now()
         where id <> ${body.id!} and tin is null
           and lower(regexp_replace(trim(customer), '\\s+', ' ', 'g')) = any(${keys})
      `;
      others = res.count;
    }
    return NextResponse.json({ ok: true, updated: updated.count, others });
  } catch (e) {
    if ((e as { code?: string })?.code === "42703") {
      return NextResponse.json({ error: "Run migration 0039_grv_sales_tin.sql first — the TIN column is missing." }, { status: 409 });
    }
    if ((e as { code?: string })?.code === "23514") {
      return NextResponse.json({ error: "A TIN is exactly 10 digits." }, { status: 400 });
    }
    throw e;
  }
}
