import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { PurchaseRequest } from "@/lib/models";

export const dynamic = "force-dynamic";

/** One-tap approve / reject from the CEO dashboard. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await dbConnect();
  const body = await req.json();
  const action = body.action as "approve" | "reject";
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 });
  }
  const pr = await PurchaseRequest.findByIdAndUpdate(
    params.id,
    {
      status: action === "approve" ? "approved" : "rejected",
      decidedBy: body.decidedBy || "Mr. Anteneh",
      decidedAt: new Date(),
    },
    { new: true }
  );
  if (!pr) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, status: pr.status });
}
