import { NextResponse } from "next/server";
import { monthLabel } from "@/lib/finance-report";
import { ledgerMonths, rawMaterialLedger } from "@/lib/raw-material-usage";
import { logError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * GET ?month=YYYY-MM — the month's raw material: opening, received, used
 * (produced tons + 5%) and what remains, day by day, with Grade 1 apart.
 *
 * Worked out from the reports on every request, so correcting a production
 * report corrects this without anything being re-filed.
 */
export async function GET(req: Request) {
  const current = monthLabel();
  const raw = new URL(req.url).searchParams.get("month") || "";
  const months = ledgerMonths(current);
  const month = months.includes(raw) ? raw : current;
  try {
    return NextResponse.json({ months, ledger: await rawMaterialLedger(month) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logError({ source: "raw-material-daily", kind: "raw_material_ledger_failed", message }).catch(() => {});
    return NextResponse.json({ months, ledger: null, error: `Raw material could not be worked out: ${message}` }, { status: 500 });
  }
}
