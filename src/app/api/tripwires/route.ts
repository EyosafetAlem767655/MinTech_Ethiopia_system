import { NextResponse } from "next/server";
import { damageTripwires } from "@/lib/metrics";

export const dynamic = "force-dynamic";

/**
 * GET — damage by worker, shift and supplier lot, for Bag control → Tripwires.
 *
 * On its own so that tab does not load the whole Brief dashboard to read one
 * table: the dashboard route also runs the day's heartbeat and every exception
 * check, and the asset page was starting all of that on each visit.
 */
export async function GET() {
  return NextResponse.json({ tripwires: await damageTripwires() });
}
