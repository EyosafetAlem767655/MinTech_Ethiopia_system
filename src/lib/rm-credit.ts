import sql from "@/lib/sql";

/**
 * Raw material bought on credit: the loads, what has been paid on each, and
 * what is still owed (migration 0040).
 *
 * A truck of Talc / Kuni / Chips / Guji / Lime Stone arrives and the supplier
 * is owed tonnes × price per tonne. Payments come later, often in pieces. What
 * is outstanding is always DERIVED — the load's amount less its payments — so
 * a corrected payment can never leave a stale balance behind.
 *
 * The bot's payment flow picks from the loads still open; like the sales
 * credit flow (credit-bot.ts), the list is read when the flow opens and carried
 * in the draft.
 */

/** Below this many birr a load counts as paid — rounding on a receipt, not a debt. */
export const RM_SETTLED_ETB = 1;

export interface RmCreditPayment {
  id: string;
  amount: number;
  paidOn: string;
  note: string | null;
  recordedBy: string;
}

export interface RmCreditLoad {
  id: string;
  /** "YYYY-MM-DD", EAT. */
  date: string;
  supplier: string;
  truckPlate: string | null;
  material: string;
  tonnes: number;
  pricePerTonne: number;
  amount: number;
  paid: number;
  remaining: number;
  status: "open" | "settled";
  note: string | null;
  reportedBy: string;
  payments: RmCreditPayment[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Every load (newest first) with its payments. Empty before 0040. */
export async function rmCreditLoads(): Promise<RmCreditLoad[]> {
  try {
    const loads = await sql<Record<string, unknown>[]>`
      select id, date_label, supplier, truck_plate, material, tonnes, price_per_tonne, amount, note, reported_by
        from raw_material_credits
       order by date desc, created_at desc
       limit 1000
    `;
    if (loads.length === 0) return [];
    const payments = await sql<Record<string, unknown>[]>`
      select id, credit_id, amount, paid_on, note, recorded_by
        from raw_material_credit_payments
       where credit_id = any(${loads.map((l) => String(l.id))})
       order by paid_on, created_at
    `;
    const byLoad = new Map<string, RmCreditPayment[]>();
    for (const p of payments) {
      const key = String(p.credit_id);
      byLoad.set(key, [
        ...(byLoad.get(key) ?? []),
        {
          id: String(p.id),
          amount: Number(p.amount) || 0,
          paidOn: new Date(String(p.paid_on)).toISOString().slice(0, 10),
          note: (p.note as string) ?? null,
          recordedBy: String(p.recorded_by),
        },
      ]);
    }
    return loads.map((l) => {
      const pays = byLoad.get(String(l.id)) ?? [];
      const amount = Number(l.amount) || 0;
      const paid = round2(pays.reduce((a, p) => a + p.amount, 0));
      const remaining = round2(amount - paid);
      return {
        id: String(l.id),
        date: String(l.date_label),
        supplier: String(l.supplier),
        truckPlate: (l.truck_plate as string) ?? null,
        material: String(l.material),
        tonnes: Number(l.tonnes) || 0,
        pricePerTonne: Number(l.price_per_tonne) || 0,
        amount,
        paid,
        remaining,
        status: remaining <= RM_SETTLED_ETB ? "settled" : "open",
        note: (l.note as string) ?? null,
        reportedBy: String(l.reported_by),
        payments: pays,
      };
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "42P01") return [];
    throw e;
  }
}

/* ─────────────────── carrying the open loads through the flow ───────────────── */

/** What the payment flow chooses from — kept small, it lives in the draft. */
export interface OpenLoad {
  id: string;
  date: string;
  supplier: string;
  truckPlate: string | null;
  material: string;
  tonnes: number;
  remaining: number;
}

export const LOADS_KEY = "_loads";

export async function openRmLoads(): Promise<OpenLoad[]> {
  return (await rmCreditLoads())
    .filter((l) => l.status === "open")
    .map(({ id, date, supplier, truckPlate, material, tonnes, remaining }) => ({
      id,
      date,
      supplier,
      truckPlate,
      material,
      tonnes,
      remaining,
    }));
}

export const encodeLoads = (rows: OpenLoad[]) => JSON.stringify(rows);

export function decodeLoads(draft: Record<string, string | number>): OpenLoad[] {
  try {
    const raw = draft[LOADS_KEY];
    const parsed = typeof raw === "string" && raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as OpenLoad[]) : [];
  } catch {
    return [];
  }
}

/** A supplier, with case and spacing ignored: "Abebe  Talc" is "abebe talc". */
export const supplierKey = (name: string) => `s:${name.toLowerCase().replace(/\s+/g, " ").trim()}`;

const money = (n: number) => Math.round(n).toLocaleString("en-US");

/** The suppliers still owed something — names only, most owed first. */
export function supplierChoices(draft: Record<string, string | number>) {
  const by = new Map<string, { name: string; total: number }>();
  for (const l of decodeLoads(draft)) {
    const k = supplierKey(l.supplier);
    const seen = by.get(k) ?? { name: l.supplier, total: 0 };
    by.set(k, { ...seen, total: seen.total + l.remaining });
  }
  return [...by.entries()].sort((a, b) => b[1].total - a[1].total).map(([value, v]) => ({ label: v.name, value }));
}

/** The open loads of the supplier picked, oldest first. */
export function loadsFor(draft: Record<string, string | number>): OpenLoad[] {
  const picked = String(draft.supplier || "");
  return decodeLoads(draft)
    .filter((l) => supplierKey(l.supplier) === picked)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function loadChoices(draft: Record<string, string | number>) {
  return loadsFor(draft).map((l) => ({
    label: `${l.date} · ${l.truckPlate || "—"} · ${l.material} ${l.tonnes} t · ${money(l.remaining)}`,
    value: l.id,
  }));
}

/** The load being paid: the one picked, or the supplier's only open one. */
export function chosenLoad(draft: Record<string, string | number>): OpenLoad | null {
  const id = String(draft.loadId || "");
  if (id) return decodeLoads(draft).find((l) => l.id === id) ?? null;
  const open = loadsFor(draft);
  return open.length === 1 ? open[0] : null;
}

export function chosenSupplierName(draft: Record<string, string | number>): string {
  return loadsFor(draft)[0]?.supplier || String(draft.supplier || "").replace(/^s:/, "");
}

/** What a load still owes RIGHT NOW — read at save, never trusted from the draft. */
export async function loadRemaining(id: string): Promise<number | null> {
  const [row] = await sql<{ amount: string; paid: string }[]>`
    select c.amount,
           coalesce((select sum(p.amount) from raw_material_credit_payments p where p.credit_id = c.id), 0) as paid
      from raw_material_credits c where c.id = ${id}::uuid
  `;
  return row ? round2((Number(row.amount) || 0) - (Number(row.paid) || 0)) : null;
}
