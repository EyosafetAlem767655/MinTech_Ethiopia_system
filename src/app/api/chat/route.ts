import { NextRequest, NextResponse } from "next/server";
import { companyChat } from "@/lib/chat";
import { AUTH_COOKIE, verifySession } from "@/lib/auth";
import { claimChatRequest, peekChatQuota, releaseChatRequest, CHAT_DAILY_LIMIT } from "@/lib/chat-quota";
import { envValue } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function chatErrorMessage(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  return message || "AI chat failed.";
}

/**
 * Who this request is metered against. The dashboard uses one shared password,
 * so the per-device session id is the finest identity available; an unsigned
 * request (auth disabled locally) falls back to a single shared bucket.
 */
async function actorFor(req: NextRequest): Promise<string> {
  const sid = await verifySession(req.cookies.get(AUTH_COOKIE)?.value);
  return sid ? `web:${sid}` : "web:anonymous";
}

/** GET — how many questions are left today, so the UI can show it up front. */
export async function GET(req: NextRequest) {
  const quota = await peekChatQuota(await actorFor(req));
  return NextResponse.json(quota);
}

export async function POST(req: NextRequest) {
  if (!envValue("GEMINI_API_KEY")) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is missing. Add it in Vercel Environment Variables and redeploy." },
      { status: 503 }
    );
  }

  const { messages } = await req.json();
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages[] required" }, { status: 400 });
  }

  // Claimed before the model call: a crash mid-answer must not hand back a free
  // retry, which would make the ceiling unenforceable exactly when something is
  // going wrong repeatedly.
  const actor = await actorFor(req);
  const quota = await claimChatRequest(actor);
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error: `You have used all ${CHAT_DAILY_LIMIT} AI questions for today. The allowance resets at midnight (EAT).`,
        quota,
      },
      { status: 429 }
    );
  }

  try {
    const reply = await companyChat(
      messages
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m) => ({ role: m.role, content: m.content }))
    );
    return NextResponse.json({ reply, quota });
  } catch (e) {
    // The answer never arrived, so hand the slot back — being charged one of ten
    // daily questions for our own outage is the wrong way round.
    console.error("chat route failed:", e);
    await releaseChatRequest(actor);
    const refunded = await peekChatQuota(actor);
    return NextResponse.json({ error: chatErrorMessage(e), quota: refunded }, { status: 503 });
  }
}
