"use client";

import { useEffect } from "react";

/** Registers the service worker once the app loads. */
export default function PwaSetup() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(Array.from(raw).map((c) => c.charCodeAt(0)));
}

export async function enablePushNotifications(): Promise<"granted" | "denied" | "unsupported"> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const reg = await navigator.serviceWorker.ready;
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return "unsupported";
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  });
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  return "granted";
}
