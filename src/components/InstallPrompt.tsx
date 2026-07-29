"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Cross-platform "install this app" UX.
 *
 * The manifest + service worker already make the app installable, which is why
 * Chrome on Android sometimes offers it on its own. This adds a dependable,
 * in-app path on every platform:
 *   • Android / Chrome / Edge / desktop — capture `beforeinstallprompt` and drive
 *     the native install dialog from our own button.
 *   • iOS Safari — there is no programmatic install API at all, so we detect iOS
 *     and show the manual "Share → Add to Home Screen" steps.
 * Once the app is running installed (standalone display mode) everything hides.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "mintech-install-dismissed";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari exposes this non-standard flag when launched from the home screen.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function detectIOS(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const iOS = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ reports as desktop Safari but is still touch + Apple.
  const iPadOS = /Macintosh/.test(ua) && "ontouchend" in document;
  return (iOS || iPadOS) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

/** Shared install state + the native-prompt trigger. */
export function useInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    setIsIOS(detectIOS());

    const onPrompt = (e: Event) => {
      e.preventDefault(); // stop Chrome's mini-infobar; we drive it ourselves
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    return outcome === "accepted";
  }, [deferred]);

  return { canInstall: !!deferred, installed, isIOS, promptInstall };
}

/* ───────────────────────────── Auto banner ─────────────────────────────── */

/** Floating banner shown above the bottom nav until installed or dismissed. */
export default function InstallPrompt() {
  const { canInstall, installed, isIOS, promptInstall } = useInstall();
  const [dismissed, setDismissed] = useState(true); // start hidden; enable after mount

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  const hide = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  if (installed || dismissed) return null;
  // Nothing to offer: not iOS and no native prompt captured (yet).
  if (!canInstall && !isIOS) return null;

  return (
    <div className="fixed inset-x-0 bottom-[4.5rem] z-40 px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-lg items-center gap-3 rounded-2xl border border-clay-100 bg-white/95 p-3 shadow-[0_8px_30px_rgba(62,22,13,0.18)] backdrop-blur">
        <span className="text-2xl">📲</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-stone-900">Install MinTech</p>
          {isIOS && !canInstall ? (
            <p className="text-[11px] leading-snug text-stone-500">
              Tap <span className="font-bold">Share</span> <span aria-hidden>􀈂</span> then{" "}
              <span className="font-bold">Add to Home Screen</span>.
            </p>
          ) : (
            <p className="text-[11px] leading-snug text-stone-500">Add it to your home screen for one-tap access.</p>
          )}
        </div>
        {canInstall && (
          <button
            onClick={async () => {
              const ok = await promptInstall();
              if (ok) hide();
            }}
            className="shrink-0 rounded-full bg-clay-700 px-4 py-2 text-xs font-bold text-white active:scale-95"
          >
            Install
          </button>
        )}
        <button onClick={hide} aria-label="Dismiss" className="shrink-0 rounded-full px-2 py-1 text-stone-400">
          ✕
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────── Always-available button ───────────────────────── */

/** An install control for Settings — reachable even after the banner is gone. */
export function InstallButton() {
  const { canInstall, installed, isIOS, promptInstall } = useInstall();
  const [showIOS, setShowIOS] = useState(false);

  if (installed) {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-4">
        <p className="text-sm font-bold text-green-800">✓ App installed</p>
        <p className="mt-0.5 text-xs text-green-700">You’re running MinTech as an installed app.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-stone-900">📲 Install the app</p>
          <p className="mt-0.5 text-xs text-stone-500">Add MinTech to your phone’s home screen.</p>
        </div>
        {canInstall ? (
          <button
            onClick={() => promptInstall()}
            className="shrink-0 rounded-full bg-clay-700 px-4 py-2 text-xs font-bold text-white active:scale-95"
          >
            Install
          </button>
        ) : isIOS ? (
          <button
            onClick={() => setShowIOS((v) => !v)}
            className="shrink-0 rounded-full bg-clay-700 px-4 py-2 text-xs font-bold text-white active:scale-95"
          >
            How?
          </button>
        ) : (
          <span className="shrink-0 text-[11px] text-stone-400">Use browser menu</span>
        )}
      </div>

      {isIOS && showIOS && (
        <ol className="mt-3 list-decimal space-y-1 rounded-xl bg-stone-50 p-3 pl-6 text-xs text-stone-600">
          <li>
            Tap the <span className="font-bold">Share</span> button in Safari.
          </li>
          <li>
            Choose <span className="font-bold">Add to Home Screen</span>.
          </li>
          <li>
            Tap <span className="font-bold">Add</span> — MinTech appears on your home screen.
          </li>
        </ol>
      )}

      {!canInstall && !isIOS && (
        <p className="mt-2 text-[11px] text-stone-400">
          On desktop/Android, open your browser menu and choose “Install app”. If it’s not there yet, keep using the
          app a moment and it will appear.
        </p>
      )}
    </div>
  );
}
