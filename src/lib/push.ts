import webpush from "web-push";
import sql from "@/lib/sql";

let configured = false;

/**
 * The VAPID subject has to be a URL — "mailto:someone@x.com" or "https://…".
 * A bare email address (the natural thing to paste into the variable) makes
 * web-push throw, and that throw used to take the whole morning brief down with
 * it. A bare address is turned into the mailto: it was meant to be.
 */
export function vapidSubject(raw = process.env.VAPID_SUBJECT): string {
  const s = (raw || "").trim();
  if (!s) return "mailto:it@mintechethiopia.com";
  if (/^(mailto:|https?:\/\/)/i.test(s)) return s;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `mailto:${s}`;
  return "mailto:it@mintechethiopia.com";
}

function configure() {
  if (configured) return false;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  try {
    webpush.setVapidDetails(vapidSubject(), pub, priv);
  } catch (e) {
    // A bad key must cost the push, never the job that wanted to send it.
    console.error("push is not configured:", e);
    return false;
  }
  configured = true;
  return true;
}

export async function broadcastPush(payload: { title: string; body: string; url?: string; tag?: string }) {
  if (!configure() && !configured) return { sent: 0, failed: 0 };

  const subs = await sql<{ endpoint: string; p256dh: string; auth: string }[]>`
    select endpoint, p256dh, auth from push_subscriptions
  `;

  let sent = 0;
  let failed = 0;
  const dead: string[] = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
        sent++;
      } catch (err: unknown) {
        failed++;
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410 mean the browser dropped the subscription — prune it.
        if (status === 404 || status === 410) dead.push(sub.endpoint);
      }
    })
  );

  if (dead.length) {
    await sql`delete from push_subscriptions where endpoint = any(${dead})`.catch(() => {});
  }

  return { sent, failed };
}

export async function savePushSubscription(sub: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  label?: string;
}) {
  await sql`
    insert into push_subscriptions (endpoint, p256dh, auth, label)
    values (${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth}, ${sub.label ?? null})
    on conflict (endpoint) do update set
      p256dh = excluded.p256dh,
      auth   = excluded.auth,
      label  = coalesce(excluded.label, push_subscriptions.label),
      updated_at = now()
  `;
}

export async function deletePushSubscription(endpoint: string) {
  await sql`delete from push_subscriptions where endpoint = ${endpoint}`;
}
