import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { companyChat } from "@/lib/chat";
import { isOpenAIConfigured } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function chatErrorMessage(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes("MongoDB Atlas") || message.includes("IP") || message.includes("whitelist")) {
    return (
      "MongoDB Atlas is blocking this deployment from connecting. The dashboard AI can read all company data after " +
      "MONGODB_URI is reachable from Vercel. In MongoDB Atlas, open Network Access and allow Vercel serverless access " +
      "(commonly 0.0.0.0/0 for Vercel serverless, or a private/static egress setup)."
    );
  }
  return message || "AI chat failed.";
}

export async function POST(req: NextRequest) {
  if (!isOpenAIConfigured()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is missing. Add it in Vercel Environment Variables and redeploy." },
      { status: 503 }
    );
  }

  const { messages } = await req.json();
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages[] required" }, { status: 400 });
  }

  try {
    await dbConnect();
    const reply = await companyChat(
      messages
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m) => ({ role: m.role, content: m.content }))
    );
    return NextResponse.json({ reply });
  } catch (e) {
    console.error("chat route failed:", e);
    return NextResponse.json({ error: chatErrorMessage(e) }, { status: 503 });
  }
}
