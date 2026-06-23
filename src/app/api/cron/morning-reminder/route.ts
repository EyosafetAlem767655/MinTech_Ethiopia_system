import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { TelegramSession } from "@/lib/models";
import { sendReportMenu } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function configuredReminderChats() {
  return (process.env.TELEGRAM_REMINDER_CHAT_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await dbConnect();
  const sessionChats = await TelegramSession.find().select("chatId").lean();
  const chatIds = Array.from(new Set([...configuredReminderChats(), ...sessionChats.map((s) => s.chatId).filter(Boolean)]));

  let sent = 0;
  const failed: { chatId: string; error: string }[] = [];
  await Promise.all(
    chatIds.map(async (chatId) => {
      try {
        const res = await sendReportMenu(
          chatId,
          "8:00 AM EAT reminder: submit today's company reports from the menu."
        );
        if (res?.ok) sent += 1;
        else failed.push({ chatId, error: JSON.stringify(res) });
      } catch (e) {
        failed.push({ chatId, error: e instanceof Error ? e.message : String(e) });
      }
    })
  );

  return NextResponse.json({ ok: true, sent, failed, recipients: chatIds.length });
}
