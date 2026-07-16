import { NextRequest, NextResponse } from "next/server";
import { assembleAndSendBrief } from "@/lib/brief";
import { appUrl } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Runs at dawn Ethiopia time (03:30 UTC = 06:30 EAT): assembles the brief, asks
 * the LLM for the narrative, and sends Telegram + push. Lot balances are now
 * derived by a view, so there is no reconciliation step.
 *
 * On the 1st of the month it also kicks off the retention job. That rides along
 * here rather than taking its own entry in vercel.json because Vercel's Hobby
 * plan caps a project at two cron jobs and both are already used. Monthly, not
 * daily: a daily run would Telegram the administrators a spreadsheet every
 * single day containing whatever had just crossed the one-year line.
 */
async function maybeRunRetention(now: Date): Promise<unknown> {
  if (now.getUTCDate() !== 1) return { ran: false, reason: "not the 1st of the month" };

  const base = appUrl();
  const secret = process.env.CRON_SECRET;
  if (!base) return { ran: false, reason: "APP_URL is not set" };

  try {
    const res = await fetch(`${base}/api/cron/archive-and-purge`, {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
      cache: "no-store",
    });
    return { ran: true, status: res.status, result: await res.json().catch(() => null) };
  } catch (e) {
    return { ran: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await assembleAndSendBrief();
  const retention = await maybeRunRetention(new Date());
  return NextResponse.json({ ok: true, ...result, retention });
}
