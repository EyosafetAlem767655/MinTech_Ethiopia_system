import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { logActivity } from "@/lib/bot-auth";
import { capabilitiesFor, positionLabelsAm } from "@/lib/positions";
import { reportKeyboardFor, sendMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REMINDER_TEXT = "እባኮትን የቀኑን ሪፖርት ያስገቡ!";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Only signed-in internal employees. External receipt submitters and users
  // who have never logged in have no business receiving a daily-report nudge.
  const employees = await sql<{ id: string; full_name: string; positions: string[]; chat_id: string }[]>`
    select id, full_name, positions, chat_id
      from telegram_users
     where active = true and logged_in = true and chat_id is not null
  `;

  let sent = 0;
  const failed: { fullName: string; error: string }[] = [];

  await Promise.all(
    employees.map(async (user) => {
      const chatId = String(user.chat_id);
      const buttons = capabilitiesFor(user.positions).map((c) => c.button);
      const text =
        `⏰ <b>${REMINDER_TEXT}</b>\n\n` +
        `👤 ${user.full_name}\n` +
        `🏷️ ${positionLabelsAm(user.positions) || "—"}\n\n` +
        `📝 "የቀኑ ሪፖርት" የሚለውን ይጫኑ፤ ጽሑፍና ፎቶ አብረው ይላኩ።`;

      try {
        const res = await sendMessage(chatId, text, { reply_markup: reportKeyboardFor(buttons) });
        if (res?.ok) {
          sent += 1;
          await logActivity({
            chatId,
            actor: user.full_name,
            userId: user.id,
            positions: user.positions,
            audience: "internal",
            action: "reminder_sent",
          });
        } else {
          failed.push({ fullName: user.full_name, error: res?.description || "unknown" });
        }
      } catch (e) {
        failed.push({ fullName: user.full_name, error: e instanceof Error ? e.message : String(e) });
      }
    })
  );

  return NextResponse.json({ ok: true, sent, failed, recipients: employees.length });
}
