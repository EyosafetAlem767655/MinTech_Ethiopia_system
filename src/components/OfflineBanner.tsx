"use client";

import { useEffect, useState } from "react";

/**
 * A strip that appears when the browser loses its connection.
 *
 * The danger on a dropping link is not the blank page — it is the page that
 * still looks fine. Every panel here fetched its numbers once on mount, so a
 * connection that died a minute ago leaves a screen full of figures that are
 * quietly stale and no longer updating. This says so.
 *
 * `navigator.onLine` only knows whether the device has a network, not whether
 * the server is reachable, so this is a hint rather than a verdict — which is
 * why it is a strip and not a takeover. The offline PAGE (public/offline.html)
 * handles the case where the app cannot be opened at all.
 */
export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    // Read once on mount as well as listening: the tab may have been opened,
    // or restored, while already offline, and no event fires for that.
    setOffline(!navigator.onLine);
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-[60] flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-center text-[11px] font-bold text-white"
    >
      📡 No connection — what you see may be out of date.
      <button
        onClick={() => window.location.reload()}
        className="rounded-full bg-white/25 px-2 py-0.5 text-[10px] font-bold hover:bg-white/35"
      >
        Retry
      </button>
    </div>
  );
}
