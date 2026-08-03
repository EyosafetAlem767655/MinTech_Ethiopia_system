import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { eatDateKey, logActivity } from "@/lib/bot-auth";
import { capabilitiesFor, hasPosition, positionLabelsAm, requiresDailyReport } from "@/lib/positions";
import { getAllDepartmentSummaries } from "@/lib/department-metrics";
import { DEPARTMENTS } from "@/lib/departments";
import { reportKeyboardFor, sendMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REMINDER_TEXT = "እባኮትን የቀኑን ሪፖርት ያስገቡ!";

interface Emp {
  id: string;
  full_name: string;
  positions: string[];
  chat_id: string;
  logged_in: boolean;
}

const nameList = (list: Emp[]) => (list.length ? list.map((u) => `• ${u.full_name}`).join("\n") : "—");

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = eatDateKey();

  // Everyone with a known chat — reminders go to daily reporters, digests to HR/Admin.
  const employees = await sql<Emp[]>`
    select id, full_name, positions, chat_id, logged_in
      from telegram_users
     where active = true and chat_id is not null
  `;

  // Who filed a daily report today.
  const submittedRows = await sql<{ user_id: string }[]>`
    select distinct user_id from daily_reports where date_key = ${today} and user_id is not null
  `;
  const submittedSet = new Set(submittedRows.map((r) => r.user_id));

  const dailyEmployees = employees.filter((u) => requiresDailyReport(u.positions));
  const submitted = dailyEmployees.filter((u) => submittedSet.has(u.id));
  const missing = dailyEmployees.filter((u) => !submittedSet.has(u.id));

  /* ─────────── 1. Reminders → daily reporters not yet in, who are signed in ─────────── */
  const toRemind = dailyEmployees.filter((u) => u.logged_in && !submittedSet.has(u.id));
  let sent = 0;
  const failed: { fullName: string; error: string }[] = [];

  await Promise.all(
    toRemind.map(async (user) => {
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

  /* ─────────── 2. HR digest → who submitted / who didn't + purchase requests ─────────── */
  const [{ n: prCount }] = await sql<{ n: string }[]>`
    select count(*) as n from purchase_requests where status in ('pending','deferred')
  `;
  const pendingPurchases = Number(prCount) || 0;

  const hrText =
    `👥 <b>የቀኑ የሪፖርት ማጠቃለያ</b> · ${today}\n\n` +
    `✅ ያስገቡ (${submitted.length}/${dailyEmployees.length}):\n${nameList(submitted)}\n\n` +
    `❌ ያላስገቡ (${missing.length}):\n${nameList(missing)}\n\n` +
    `🛒 በመጠባበቅ ላይ ያሉ የግዢ ጥያቄዎች: <b>${pendingPurchases}</b>`;

  const hrUsers = employees.filter((u) => hasPosition(u.positions, "hr"));
  await Promise.all(hrUsers.map((u) => sendMessage(String(u.chat_id), hrText).catch(() => {})));

  /* ─────────── 3. Admin digest → concise per-department activity + who missed ─────────── */
  const summaries = await getAllDepartmentSummaries("daily");
  const deptLines = summaries
    .map((s) => `${DEPARTMENTS[s.department].icon} ${DEPARTMENTS[s.department].name}: <b>${s.activityCount}</b>`)
    .join("\n");

  const adminText =
    `🛡 <b>የዕለት ማጠቃለያ</b> · ${today}\n\n` +
    `${deptLines}\n\n` +
    `✅ ሪፖርት ያስገቡ: <b>${submitted.length}/${dailyEmployees.length}</b>\n` +
    (missing.length ? `❌ ያላስገቡ:\n${nameList(missing)}` : `🎉 ሁሉም ሪፖርት አስገብተዋል!`) +
    `\n🛒 የግዢ ጥያቄዎች: <b>${pendingPurchases}</b>`;

  const adminUsers = employees.filter((u) => hasPosition(u.positions, "admin"));
  await Promise.all(adminUsers.map((u) => sendMessage(String(u.chat_id), adminText).catch(() => {})));

  return NextResponse.json({
    ok: true,
    date: today,
    reminded: toRemind.length,
    sent,
    failed,
    dailyReporters: dailyEmployees.length,
    submitted: submitted.length,
    missing: missing.length,
    hrDigests: hrUsers.length,
    adminDigests: adminUsers.length,
  });
}
