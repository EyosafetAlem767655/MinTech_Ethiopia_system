import nodemailer from "nodemailer";
import { envValue } from "@/lib/env";

/**
 * Email from the owner's Gmail, for sending a new dashboard login.
 *
 * Gmail SMTP with an App Password (Google Account → Security → App passwords),
 * set in Vercel as GMAIL_USER and GMAIL_APP_PASSWORD. Without both, sending is
 * reported as not configured rather than failing the account it belongs to.
 */

export function mailConfigured(): boolean {
  return Boolean(envValue("GMAIL_USER") && envValue("GMAIL_APP_PASSWORD"));
}

export async function sendMail(to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const user = envValue("GMAIL_USER");
  const pass = envValue("GMAIL_APP_PASSWORD");
  if (!user || !pass) return { ok: false, error: "GMAIL_USER and GMAIL_APP_PASSWORD are not set in Vercel." };
  if (!/^\S+@\S+\.\S+$/.test(to.trim())) return { ok: false, error: `Not an email address: ${to}` };
  try {
    const transport = nodemailer.createTransport({
      service: "gmail",
      // App passwords are shown with spaces ("abcd efgh ijkl mnop"); Gmail wants them without.
      auth: { user, pass: pass.replace(/\s+/g, "") },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    await transport.sendMail({ from: `MinTech Ethiopia <${user}>`, to: to.trim(), subject, text });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
