import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { companyChat } from "@/lib/chat";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  await dbConnect();
  const { messages } = await req.json();
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages[] required" }, { status: 400 });
  }
  const reply = await companyChat(
    messages
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({ role: m.role, content: m.content }))
  );
  return NextResponse.json({ reply });
}
