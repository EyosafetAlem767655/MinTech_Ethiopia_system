import webpush from "web-push";
import { PushSubscription } from "@/lib/models";

let configured = false;
function configure() {
  if (configured) return false;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:it@mintechethiopia.com", pub, priv);
  configured = true;
  return true;
}

export async function broadcastPush(payload: { title: string; body: string; url?: string; tag?: string }) {
  if (!configure() && !configured) return { sent: 0, failed: 0 };
  const subs = await PushSubscription.find().lean();
  let sent = 0;
  let failed = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload)
        );
        sent++;
      } catch (err: unknown) {
        failed++;
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await PushSubscription.deleteOne({ endpoint: sub.endpoint });
        }
      }
    })
  );
  return { sent, failed };
}
