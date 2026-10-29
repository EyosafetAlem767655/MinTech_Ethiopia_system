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
 * "Same name" is a SIMILAR name from migration 0046 on — normalised, with a
 * letter or two of typo allowed (`customer_names_match`) — and a sale with no
 * TIN takes one only when exactly one TIN matches. Before 0046 it is the exact
 * name, as it always was.
 *
 * Returns how many rows were changed. Before migration 0039 there is no `tin`
 * column, and this does nothing.
 */
export async function linkCustomerTin(id: string): Promise<number> {
  try {
    return await linkSimilar(id);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "42703") return 0; // no tin column yet (0039)
    if (code !== "42883") throw e; // 42883: no customer_names_match yet (0046)
  }
  return linkExact(id);
}

async function linkSimilar(id: string): Promise<number> {
  const [row] = await sql<{ tin: string | null; customer: string }[]>`
    select tin, customer from sales_invoices where id = ${id}
  `;
  if (!row || !customerKey(row.customer)) return 0;

  if (isTin(row.tin)) {
    const [r] = await sql<{ n: number }[]>`select fill_customer_tins(${row.tin}) as n`;
    return Number(r?.n) || 0;
  }

  const known = await sql<{ tin: string }[]>`
    select distinct tin from sales_invoices
     where tin ~ '^[0-9]{10}$' and id <> ${id}
       and customer_names_match(customer, ${row.customer})
  `;
  if (known.length !== 1) return 0;
  const updated = await sql`
    update sales_invoices set tin = ${known[0].tin}, updated_at = now() where id = ${id} and tin is null
  `;
  return updated.count;
}

async function linkExact(id: string): Promise<number> {
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
