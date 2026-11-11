"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * What a report section shows when it is not showing its data: waiting, failed,
 * or not reached yet. The same three everywhere, in words, because a pulsing grey
 * box reads as broken and an empty list after a failed request reads as "nothing
 * was filed", which is the one wrong answer a report must never give.
 */

/** A section's JSON. Throws what went wrong, so a failure is never mistaken for no data. */
export async function getJson<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (body as { error?: string } | null)?.error ||
        (res.status === 504 ? "It took too long to answer." : `The server answered with an error (HTTP ${res.status}).`)
    );
  }
  return body as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SectionLoading({ title }: { title: string }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="card flex items-start gap-3 border-l-4 border-l-clay-500 p-4" role="status" aria-live="polite">
      <span className="mt-0.5 inline-block animate-spin text-lg leading-none text-clay-600" aria-hidden="true">
        ⟳
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold text-stone-800">Loading {title}…</p>
        <p className="mt-0.5 text-xs text-stone-500">
          {slow ? "Still working. This can take up to a minute, please stay on this page." : "This can take a moment."}
        </p>
      </div>
    </div>
  );
}

export function SectionError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div className="card border-l-4 border-l-red-500 p-4">
      <p className="text-sm font-bold text-stone-800">{title} could not be loaded</p>
      <p className="mt-0.5 text-xs text-red-700">{message}</p>
      <button
        onClick={onRetry}
        className="mt-2 rounded-lg bg-clay-700 px-3 py-1.5 text-xs font-bold text-white transition active:scale-[0.98]"
      >
        Try again
      </button>
    </div>
  );
}

/**
 * Starts a section when it comes near the screen, and keeps it from then on.
 *
 * The tall placeholder is what makes this work: without it every waiting section
 * would sit on screen at once and they would all start together, which is the
 * pile-up on the database this exists to prevent.
 */
export function LazySection({ title, anchor, children }: { title: string; anchor?: string; children: ReactNode }) {
  const [near, setNear] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Opened on this section's own link (#store): start it now and keep it in view.
    if (anchor && window.location.hash === `#${anchor}`) {
      setNear(true);
      setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }), 50);
      return;
    }
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [anchor]);

  if (near) return <>{children}</>;
  return (
    <div ref={box} className="min-h-[70vh]">
      <p className="px-1 text-xs font-bold uppercase tracking-widest text-stone-300">{title}</p>
    </div>
  );
}
