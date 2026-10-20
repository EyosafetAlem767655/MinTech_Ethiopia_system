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

/** What a payment paid: the raw material itself, or the driver's fee (0043). */
export type RmPart = "material" | "driver";

export interface RmCreditPayment {
  id: string;
  part: RmPart;
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
  /** The three people behind a load (0043). Null on loads filed before. */
  quarryOwner: string | null;
  salesAgent: string | null;
  driverName: string | null;
  truckPlate: string | null;
  material: string;
  tonnes: number;
  pricePerTonne: number;
  /** The raw material's total price. */
  amount: number;
  /** The driver's fee — owed separately (0 on older loads). */
  driverFee: number;
  materialPaid: number;
  driverPaid: number;
  materialLeft: number;
  driverLeft: number;
  /** Paid on both parts together. */
  paid: number;
  /** Still owed on both parts together. */
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
    // The people and the driver's fee arrive in 0043; a database without it
    // reads every load as material only, exactly as before.
    const loads = await sql<Record<string, unknown>[]>`
      select id, date_label, supplier, truck_plate, material, tonnes, price_per_tonne, amount, note, reported_by,
             quarry_owner, sales_agent, driver_name, driver_fee
        from raw_material_credits
       order by date desc, created_at desc
       limit 1000
    `.catch((e) => {
      if ((e as { code?: string })?.code !== "42703") throw e;
      return sql<Record<string, unknown>[]>`
        select id, date_label, supplier, truck_plate, material, tonnes, price_per_tonne, amount, note, reported_by
          from raw_material_credits
         order by date desc, created_at desc
         limit 1000
      `;
    });
    if (loads.length === 0) return [];
    const ids = loads.map((l) => String(l.id));
    const payments = await sql<Record<string, unknown>[]>`
      select id, credit_id, part, amount, paid_on, note, recorded_by
        from raw_material_credit_payments
       where credit_id = any(${ids})
       order by paid_on, created_at
    `.catch((e) => {
      if ((e as { code?: string })?.code !== "42703") throw e;
      return sql<Record<string, unknown>[]>`
        select id, credit_id, amount, paid_on, note, recorded_by
          from raw_material_credit_payments
         where credit_id = any(${ids})
         order by paid_on, created_at
      `;
    });
    const byLoad = new Map<string, RmCreditPayment[]>();
    for (const p of payments) {
      const key = String(p.credit_id);
      byLoad.set(key, [
        ...(byLoad.get(key) ?? []),
        {
          id: String(p.id),
          part: p.part === "driver" ? "driver" : "material",
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
      const driverFee = Number(l.driver_fee) || 0;
      const materialPaid = round2(pays.filter((p) => p.part === "material").reduce((a, p) => a + p.amount, 0));
      const driverPaid = round2(pays.filter((p) => p.part === "driver").reduce((a, p) => a + p.amount, 0));
      const materialLeft = round2(amount - materialPaid);
      const driverLeft = round2(driverFee - driverPaid);
      const paid = round2(materialPaid + driverPaid);
      const remaining = round2(Math.max(0, materialLeft) + Math.max(0, driverLeft));
      return {
        id: String(l.id),
        date: String(l.date_label),
        supplier: String(l.supplier),
        quarryOwner: (l.quarry_owner as string) ?? null,
        salesAgent: (l.sales_agent as string) ?? null,
        driverName: (l.driver_name as string) ?? null,
        truckPlate: (l.truck_plate as string) ?? null,
        material: String(l.material),
        tonnes: Number(l.tonnes) || 0,
        pricePerTonne: Number(l.price_per_tonne) || 0,
        amount,
        driverFee,
        materialPaid,
        driverPaid,
        materialLeft,
        driverLeft,
        paid,
        remaining,
        // Settled only when BOTH the material and the driver are paid.
        status: materialLeft <= RM_SETTLED_ETB && driverLeft <= RM_SETTLED_ETB ? "settled" : "open",
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
  /** Who it is owed to, and what is left on each part (0043). */
  owner?: string;
  driverName?: string | null;
  materialLeft?: number;
  driverLeft?: number;
}

export const LOADS_KEY = "_loads";

export async function openRmLoads(): Promise<OpenLoad[]> {
  return (await rmCreditLoads())
    .filter((l) => l.status === "open")
    .map(({ id, date, supplier, quarryOwner, driverName, truckPlate, material, tonnes, remaining, materialLeft, driverLeft }) => ({
      id,
      date,
      supplier,
      truckPlate,
      material,
      tonnes,
      remaining,
      owner: quarryOwner || supplier,
      driverName,
      materialLeft,
      driverLeft,
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

/**
 * What a load still owes RIGHT NOW — read at save, never trusted from the
 * draft. With `part`, on that part only: the raw material, or the driver's fee.
 */
export async function loadRemaining(id: string, part?: RmPart): Promise<number | null> {
  if (part) {
    const [row] = await sql<{ owed: string; paid: string }[]>`
      select case when ${part} = 'driver' then c.driver_fee else c.amount end as owed,
             coalesce((select sum(p.amount) from raw_material_credit_payments p
                        where p.credit_id = c.id and p.part = ${part}), 0) as paid
        from raw_material_credits c where c.id = ${id}::uuid
    `;
    return row ? round2((Number(row.owed) || 0) - (Number(row.paid) || 0)) : null;
  }
  const [row] = await sql<{ amount: string; paid: string }[]>`
    select c.amount,
           coalesce((select sum(p.amount) from raw_material_credit_payments p where p.credit_id = c.id), 0) as paid
      from raw_material_credits c where c.id = ${id}::uuid
  `;
  return row ? round2((Number(row.amount) || 0) - (Number(row.paid) || 0)) : null;
}

/* ─────────────────── the payment form: one list of what is unpaid ─────────────── */

export const PART_LABEL: Record<RmPart, string> = { material: "ጥሬ ዕቃ", driver: "ሹፌር" };

/** Every unpaid part of every open load, oldest first — one button each. */
export function owedChoices(draft: Record<string, string | number>) {
  const out: { label: string; value: string }[] = [];
  const loads = decodeLoads(draft).sort((a, b) => a.date.localeCompare(b.date));
  for (const l of loads) {
    const parts: [RmPart, number][] = [
      ["material", l.materialLeft ?? l.remaining],
      ["driver", l.driverLeft ?? 0],
    ];
    for (const [part, left] of parts) {
      if (left <= RM_SETTLED_ETB) continue;
      const who = part === "driver" ? l.driverName || "ሹፌር" : l.owner || l.supplier;
      out.push({
        label: `${l.date} · ${who} · ${l.truckPlate || "—"} · ${l.material} ${l.tonnes}t · ${PART_LABEL[part]} ${money(left)} ቀሪ`,
        value: `${l.id}|${part}`,
      });
    }
  }
  return out;
}

/** The load and part picked on the payment form, with what was left on it. */
export function chosenOwed(draft: Record<string, string | number>): { load: OpenLoad; part: RmPart; left: number } | null {
  const [id, rawPart] = String(draft.owed || "").split("|");
  const load = decodeLoads(draft).find((l) => l.id === id);
  if (!load) return null;
  const part: RmPart = rawPart === "driver" ? "driver" : "material";
  const left = part === "driver" ? load.driverLeft ?? 0 : load.materialLeft ?? load.remaining;
  return { load, part, left };
}
