import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { PushSubscription } from "@/lib/models";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  await dbConnect();
  const body = await req.json();
  if (!body?.endpoint || !body?.keys?.p256dh) {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }
  await PushSubscription.findOneAndUpdate(
    { endpoint: body.endpoint },
    { endpoint: body.endpoint, keys: body.keys, label: body.label || "dashboard" },
    { upsert: true }
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  await dbConnect();
  const body = await req.json();
  await PushSubscription.deleteOne({ endpoint: body?.endpoint });
  return NextResponse.json({ ok: true });
}
