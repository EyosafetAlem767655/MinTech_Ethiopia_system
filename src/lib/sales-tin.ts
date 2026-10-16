import sql from "@/lib/sql";

/**
 * A customer is their TIN, not their name.
 *
 * Names on the sales sheet are typed — and read off receipts — with every
 * spelling there is, so a customer grouped by name splits into three. The TIN is
 * printed on the invoice and does not change. Sales filed before TINs were read
 * have none; this is how they get one without anybody retyping a month.
 */

/** Exactly ten digits — an Ethiopian TIN. */
export const isTin = (v: unknown): v is string => typeof v === "string" && /^\d{10}$/.test(v);

/** The comparison form of a customer name: case and spacing are noise. */
export const customerKey = (name: string) => String(name || "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * After a sale is saved: share its TIN with the customer's older sales, or
 * take one from them.
 *
 *  - The new sale HAS a TIN → every earlier sale under the same name with no TIN
 *    gets it. A sale that already carries a different TIN is left alone: two
 *    buyers can share a name, and a TIN somebody set is not overwritten.
 *  - The new sale has NONE → it takes the TIN most recently recorded under that
 *    name, if there is one.
 *
 * Returns how many rows were changed. Before migration 0039 there is no `tin`
 * column, and this does nothing.
 */
export async function linkCustomerTin(id: string): Promise<number> {
  try {
    const [row] = await sql<{ tin: string | null; customer: string }[]>`
      select tin, customer from sales_invoices where id = ${id}
    `;
    if (!row) return 0;
    const key = customerKey(row.customer);
    if (!key) return 0;

    if (isTin(row.tin)) {
      const updated = await sql`
        update sales_invoices set tin = ${row.tin}, updated_at = now()
         where tin is null and lower(regexp_replace(trim(customer), '\\s+', ' ', 'g')) = ${key}
      `;
      return updated.count;
    }

    const [known] = await sql<{ tin: string }[]>`
      select tin from sales_invoices
       where tin is not null and lower(regexp_replace(trim(customer), '\\s+', ' ', 'g')) = ${key}
       order by date desc, created_at desc
       limit 1
    `;
    if (!known) return 0;
    const updated = await sql`update sales_invoices set tin = ${known.tin}, updated_at = now() where id = ${id}`;
    return updated.count;
  } catch (e) {
    if ((e as { code?: string })?.code === "42703") return 0; // no tin column yet (0039)
    throw e;
  }
}
