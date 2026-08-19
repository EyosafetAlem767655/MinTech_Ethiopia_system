import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { eatDateKey, logActivity } from "@/lib/bot-auth";
import {
  filesFreeTextDailyReport,
  hasPosition,
  positionLabelsAm,
  requiresDailyReport,
  resolveCapabilities,
} from "@/lib/positions";
import { splitByCompliance } from "@/lib/compliance";
import { getAllDepartmentSummaries } from "@/lib/department-metrics";
import { DEPARTMENTS } from "@/lib/departments";
import { reportKeyboardFor, sendMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REMINDER_TEXT = "እባኮትን የቀኑን ሪፖርት ያስገቡ!";
/** For roles that report through the guided flows rather than a daily write-up. */
const REMINDER_TEXT_ANY = "እባኮትን የዛሬውን ሥራ ያስመዝግቡ!";

interface Emp {
  id: string;
  full_name: string;
  positions: string[];
  capabilities: string[] | null;
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
    select id, full_name, positions, capabilities, chat_id, logged_in
      from telegram_users
     where active = true and chat_id is not null
  `;

  // Who reported today — measured against each role's OWN tables, not just
  // `daily_reports`. Only the free-text `daily_report` capability writes that
  // table, so roles that file through the guided flows could never be counted
  // as done and were re-reminded every morning after submitting.
  const dailyEmployees = employees.filter((u) => requiresDailyReport(u.positions));
  const { submitted, missing } = await splitByCompliance(today, dailyEmployees);
  const missingIds = new Set(missing.map((u) => u.id));

  /* ─────────── 1. Reminders → daily reporters not yet in, who are signed in ─────────── */
  const toRemind = dailyEmployees.filter((u) => u.logged_in && missingIds.has(u.id));
  let sent = 0;
  const failed: { fullName: string; error: string }[] = [];

  await Promise.all(
    toRemind.map(async (user) => {
      const chatId = String(user.chat_id);
      const caps = resolveCapabilities(user.positions, user.capabilities);
      const buttons = caps.map((c) => c.button);

      // Someone without the free-text daily report has no "የቀኑ ሪፖርት" button, so
      // naming it just tells them to press something that isn't there. List
      // their own buttons instead.
      const writesDailyReport = filesFreeTextDailyReport(user.positions, user.capabilities);
      const instruction = writesDailyReport
        ? `📝 "የቀኑ ሪፖርት" የሚለውን ይጫኑ፤ ጽሑፍና ፎቶ አብረው ይላኩ።`
        : `📝 እባኮትን ከሚከተሉት አንዱን ይጠቀሙ፦\n${buttons.map((b) => `• ${b}`).join("\n")}`;

      const text =
        `⏰ <b>${writesDailyReport ? REMINDER_TEXT : REMINDER_TEXT_ANY}</b>\n\n` +
        `👤 ${user.full_name}\n` +
        `🏷️ ${positionLabelsAm(user.positions) || "—"}\n\n` +
        instruction;
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

  // The open tool requests themselves, not just a count: HR and Admin are the
  // people who act on them, and a bare number tells them nothing about what is
  // being asked for or whether the AI found the damage photo convincing.
  const openTools = await sql<
    { title: string; quantity: string | null; kind: string | null; legitimacy: Record<string, unknown> | null }[]
  >`
    select title, quantity, kind, legitimacy
      from purchase_requests
     where status = 'pending'
     order by created_at desc
     limit 10
  `.catch(() => []);

  const toolLines = openTools
    .map((t) => {
      const qty = t.quantity ? ` ×${Number(t.quantity)}` : "";
      const kind = t.kind === "maintenance" ? "🛠" : t.kind === "new_item" ? "🆕" : "•";
      const c = t.legitimacy as { checked?: boolean; plausible?: boolean; confidence?: number } | null;
      // Only maintenance requests carry a photo verdict, and an unrun check is
      // reported as such rather than as a low score.
      const ai =
        t.kind === "maintenance" && c
          ? c.checked
            ? ` · AI ${c.plausible ? "✅" : "⚠️"} ${c.confidence ?? 0}%`
            : " · AI ⏳"
          : "";
      return `  ${kind} ${t.title}${qty}${ai}`;
    })
    .join("\n");

  const toolBlock = toolLines
    ? `\n\n🔧 <b>የመሣሪያ ጥያቄዎች</b>\n${toolLines}`
    : "";

  const hrText =
    `👥 <b>የቀኑ የሪፖርት ማጠቃለያ</b> · ${today}\n\n` +
    `✅ ያስገቡ (${submitted.length}/${dailyEmployees.length}):\n${nameList(submitted)}\n\n` +
    `❌ ያላስገቡ (${missing.length}):\n${nameList(missing)}\n\n` +
    `🛒 በመጠባበቅ ላይ ያሉ የግዢ ጥያቄዎች: <b>${pendingPurchases}</b>` +
    toolBlock;

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
    `\n🛒 የግዢ ጥያቄዎች: <b>${pendingPurchases}</b>` +
    toolBlock;

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
