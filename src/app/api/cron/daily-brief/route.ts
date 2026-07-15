import { NextRequest, NextResponse } from "next/server";
import { assembleAndSendBrief } from "@/lib/brief";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The one Vercel Cron job (Hobby tier allows one per day): runs at dawn
 * Ethiopia time (03:30 UTC = 06:30 EAT), assembles the brief, asks the LLM for
 * the narrative, and sends Telegram + push. Lot balances are now derived by a
 * view, so there is no reconciliation step.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await assembleAndSendBrief();
  return NextResponse.json({ ok: true, ...result });
}
