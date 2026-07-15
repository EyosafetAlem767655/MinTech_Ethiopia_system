import { NextRequest, NextResponse } from "next/server";
import { deletePushSubscription, savePushSubscription } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body?.endpoint || !body?.keys?.p256dh) {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }
  await savePushSubscription({ endpoint: body.endpoint, keys: body.keys, label: body.label || "dashboard" });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  if (body?.endpoint) await deletePushSubscription(String(body.endpoint));
  return NextResponse.json({ ok: true });
}
