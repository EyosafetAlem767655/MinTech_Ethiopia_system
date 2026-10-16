import { NextResponse } from "next/server";
import { rmCreditLoads } from "@/lib/rm-credit";
import { eatDateLabel } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * GET — raw material bought on credit: every load with its payments, what is
 * still owed per supplier, and the totals for the tiles.
 */
export async function GET() {
  const loads = await rmCreditLoads();
  const thisMonth = eatDateLabel(new Date()).slice(0, 7);

  const suppliers = new Map<string, { supplier: string; loads: number; open: number; tonnes: number; amount: number; paid: number; remaining: number }>();
  for (const l of loads) {
    const key = l.supplier.toLowerCase().replace(/\s+/g, " ").trim();
    const s = suppliers.get(key) ?? { supplier: l.supplier, loads: 0, open: 0, tonnes: 0, amount: 0, paid: 0, remaining: 0 };
    s.loads += 1;
    if (l.status === "open") s.open += 1;
    s.tonnes += l.tonnes;
    s.amount += l.amount;
    s.paid += l.paid;
    s.remaining += Math.max(0, l.remaining);
    suppliers.set(key, s);
  }

  const open = loads.filter((l) => l.status === "open");
  return NextResponse.json({
    loads,
    suppliers: [...suppliers.values()].sort((a, b) => b.remaining - a.remaining),
    totals: {
      outstanding: open.reduce((a, l) => a + l.remaining, 0),
      openLoads: open.length,
      tonnesOnCredit: open.reduce((a, l) => a + l.tonnes, 0),
      paidThisMonth: loads.flatMap((l) => l.payments).filter((p) => p.paidOn.startsWith(thisMonth)).reduce((a, p) => a + p.amount, 0),
    },
  });
}
