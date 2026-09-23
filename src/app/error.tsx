"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Something threw while rendering a page.
 *
 * The two useful things here are a way to try again without losing the session
 * (`reset()` re-renders the segment rather than reloading the app) and the
 * digest — Next replaces a server error's message with an opaque id in
 * production, and that id is the only thing that ties this screen to the line in
 * the platform log.
 *
 * Deliberately NOT a bare "something went wrong": that sentence is what the bot
 * used to say before the error log existed, and it told nobody anything.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Always in the browser console too, whatever the UI manages to show.
    console.error("page error:", error);
  }, [error]);

  const offline = typeof navigator !== "undefined" && !navigator.onLine;

  return (
    <main className="app-shell flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <span className="text-5xl">{offline ? "📡" : "⚠️"}</span>
      <h1 className="mt-4 font-display text-2xl font-bold text-clay-900">
        {offline ? "You are offline" : "This page could not load"}
      </h1>
      <p className="mt-2 max-w-sm text-sm text-stone-500">
        {offline
          ? "The app cannot reach the server. Check the connection and try again — nothing you have submitted is affected."
          : "Something failed while building this screen. Trying again usually works; if it does not, the details below help trace it."}
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={reset}
          className="rounded-full bg-clay-700 px-5 py-2.5 text-sm font-bold text-white transition-all active:scale-95"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-full bg-stone-100 px-5 py-2.5 text-sm font-bold text-stone-700 transition-all active:scale-95"
        >
          Back to the Brief
        </Link>
      </div>

      {error.digest && <p className="mt-6 font-mono text-[10px] text-stone-400">ref {error.digest}</p>}
    </main>
  );
}
