import { NextResponse } from "next/server";
import sql from "@/lib/sql";

export const dynamic = "force-dynamic";

/** GET — recent raw-material-received reports. */
export async function GET() {
  const rows = await sql`
    select id as _id, date, supplier, dn_no as "dnNo", truck_plate as "truckPlate",
           mrv_no as "mrvNo", reported_by as "reportedBy", materials, created_at as "createdAt"
      from raw_material_receipts
     order by date desc, created_at desc
     limit 200
  `;
  return NextResponse.json(rows);
}
