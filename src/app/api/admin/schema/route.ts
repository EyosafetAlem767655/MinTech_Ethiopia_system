import { NextResponse } from "next/server";
import { BACKFILL_MIGRATION, checkSchema } from "@/lib/schema-check";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET — does the database have what this deployment writes to?
 *
 * Read-only and behind the dashboard password like every other /api path
 * (middleware.ts). Returns the fix as well as the fault: a missing column is
 * only actionable with the name of the file that adds it.
 */
export async function GET() {
  const report = await checkSchema();
  return NextResponse.json({ ...report, backfill: BACKFILL_MIGRATION });
}
