import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { buildDamageRegisterPdf } from "@/lib/pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  await dbConnect();
  const pdf = await buildDamageRegisterPdf();
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="mintech-damage-register-${stamp}.pdf"`,
    },
  });
}
