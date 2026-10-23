import { NextRequest, NextResponse } from "next/server";
import { envValue } from "@/lib/env";
import { mailConfigured, sendMail } from "@/lib/mailer";
import { sendSms, smsGatewayConfigured } from "@/lib/sms";
import { ROLE_LABEL } from "@/lib/roles";
import { logError } from "@/lib/errors";
import {
  createWebUser,
  deleteWebUser,
  listWebUsers,
  resetWebUserPassword,
  setWebUserRevoked,
  type WebRole,
  type WebUser,
} from "@/lib/web-users";

export const dynamic = "force-dynamic";

/*
 * Dashboard accounts — the Super Admin only. The middleware refuses every other
 * role before a request reaches this file (SUPER_ONLY_API in src/lib/roles.ts).
 */

/** GET — every account, and which ways a new password can be sent. */
export async function GET() {
  const { users, unavailable } = await listWebUsers();
  return NextResponse.json({ users, unavailable, channels: { sms: smsGatewayConfigured(), email: mailConfigured() } });
}

/**
 * Send a new login to its owner by SMS and/or email. The password is also
 * returned to the Super Admin's screen, so a failed send never loses it.
 */
async function deliver(user: WebUser, password: string, send: { sms?: boolean; email?: boolean }) {
  const url = envValue("APP_URL") || "the MinTech dashboard";
  const text =
    `MinTech dashboard login (${ROLE_LABEL[user.role]})\n` +
    `Name: ${user.name}\nPassword: ${password}\n${url}`;
  const out: { sms?: { ok: boolean; error?: string }; email?: { ok: boolean; error?: string } } = {};
  if (send.sms && user.phone) {
    const r = await sendSms(user.phone, text);
    out.sms = { ok: r.ok, error: r.ok ? undefined : r.error };
  }
  if (send.email && user.email) out.email = await sendMail(user.email, "Your MinTech dashboard login", text);
  await reportFailures(out, user.name);
  return out;
}

/** A failed send is recorded under Settings → Errors with the gateway's own reason. */
async function reportFailures(
  out: { sms?: { ok: boolean; error?: string }; email?: { ok: boolean; error?: string } },
  who: string
) {
  for (const [channel, r] of Object.entries(out)) {
    if (!r || r.ok) continue;
    await logError({
      source: "web-users",
      kind: `login_${channel}_failed`,
      message: r.error || "unknown error",
      detail: { channel, account: who },
    }).catch(() => {});
  }
}

/**
 * POST — create an account: { name, role, phone?, email?, sendSms?, sendEmail? }.
 * POST { test: true, phone?, email? } — send a test SMS / email and report
 * exactly what each gateway answered, so a send that is not arriving can be
 * told apart from one that is refused.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (body.test) {
    const text = "MinTech dashboard: test message. If you can read this, sending logins works.";
    const out: { sms?: { ok: boolean; error?: string }; email?: { ok: boolean; error?: string } } = {};
    if (body.phone) {
      const r = await sendSms(String(body.phone), text);
      out.sms = r.skipped
        ? { ok: false, error: "SMS is not configured: set HTTPSMS_API_KEY and PHONE_NUMBER in Vercel." }
        : { ok: r.ok, error: r.ok ? undefined : r.error };
    }
    if (body.email) out.email = await sendMail(String(body.email), "MinTech dashboard — test", text);
    await reportFailures(out, "test");
    return NextResponse.json({ ok: true, sent: out });
  }
  try {
    const { user, password } = await createWebUser({
      name: String(body.name || ""),
      role: body.role as WebRole,
      phone: body.phone ? String(body.phone) : null,
      email: body.email ? String(body.email) : null,
    });
    const sent = await deliver(user, password, { sms: !!body.sendSms, email: !!body.sendEmail });
    return NextResponse.json({ ok: true, user, password, sent });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "42P01") {
      return NextResponse.json({ error: "Run migration 0045_web_users.sql in Supabase first." }, { status: 503 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

/** PATCH — { id, action: "revoke" | "restore" | "reset", sendSms?, sendEmail? }. */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Unknown account." }, { status: 400 });
  if (body.action === "revoke" || body.action === "restore") {
    const ok = await setWebUserRevoked(id, body.action === "revoke");
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Unknown account." }, { status: 404 });
  }
  if (body.action === "reset") {
    const res = await resetWebUserPassword(id);
    if (!res) return NextResponse.json({ error: "Unknown account." }, { status: 404 });
    const sent = await deliver(res.user, res.password, { sms: !!body.sendSms, email: !!body.sendEmail });
    return NextResponse.json({ ok: true, user: res.user, password: res.password, sent });
  }
  return NextResponse.json({ error: "action must be revoke, restore or reset" }, { status: 400 });
}

/** DELETE ?id= — remove an account from the database for good. */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Unknown account." }, { status: 400 });
  const ok = await deleteWebUser(id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Unknown account." }, { status: 404 });
}
