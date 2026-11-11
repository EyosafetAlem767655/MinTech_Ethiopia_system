"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { GUIDE } from "@/lib/guide-content";

/**
 * 📖 Guide: how to read every part of the dashboard, with a link to each.
 * Static, so it opens at once; the content lives in src/lib/guide-content.ts.
 */
export default function GuidePage() {
  const [q, setQ] = useState("");

  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return GUIDE;
    return GUIDE.map((s) => ({
      ...s,
      items: s.items.filter((it) =>
        [s.title, it.title, it.source ?? "", ...it.body].some((t) => t.toLowerCase().includes(needle))
      ),
    })).filter((s) => s.items.length > 0);
  }, [q]);

  return (
    <main className="app-shell px-4 pb-24 pt-4">
      <header className="hero-gradient -mx-4 px-5 pb-6 pt-8 text-white sm:mx-0 sm:rounded-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-clay-100">Guide</p>
        <h1 className="font-display text-2xl font-bold">📖 How to read the dashboard</h1>
        <p className="mt-1 text-sm text-clay-100/90">
          What every section shows, where its figures come from, and a link to open it.
        </p>
      </header>

      <div className="sticky top-0 z-20 -mx-4 bg-[#faf6f4]/95 px-4 py-3 backdrop-blur sm:mx-0">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the guide (e.g. gap, net pay, grade 1)"
          aria-label="Search the guide"
          className="w-full rounded-xl border border-clay-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-clay-500"
        />
      </div>

      {!q && (
        <nav aria-label="Contents" className="card mb-4 p-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-stone-400">Contents</p>
          <div className="flex flex-wrap gap-1.5">
            {GUIDE.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="rounded-full bg-clay-50 px-3 py-1 text-xs font-bold text-clay-800 hover:bg-clay-100"
              >
                {s.icon} {s.title}
              </a>
            ))}
          </div>
        </nav>
      )}

      {sections.length === 0 && <p className="card p-4 text-sm text-stone-500">Nothing in the guide matches “{q}”.</p>}

      <div className="space-y-6">
        {sections.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-20">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
              <h2 className="font-display text-lg font-bold text-stone-900">
                {s.icon} {s.title}
              </h2>
              {s.href && (
                <Link href={s.href} className="text-xs font-bold text-clay-700 hover:underline">
                  Open {s.title} →
                </Link>
              )}
            </div>
            <p className="mb-2 px-1 text-xs text-stone-500">{s.intro}</p>
            <div className="space-y-2">
              {s.items.map((it) => (
                <article key={it.title} className="card p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-bold text-stone-800">{it.title}</h3>
                    {it.href && (
                      <Link href={it.href} className="shrink-0 text-[11px] font-bold text-clay-700 hover:underline">
                        Open →
                      </Link>
                    )}
                  </div>
                  <ul className="mt-1.5 space-y-1 text-[13px] leading-relaxed text-stone-600">
                    {it.body.map((line) => (
                      <li key={line} className="flex gap-1.5">
                        <span className="select-none text-stone-300">•</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                  {it.source && <p className="mt-2 text-[11px] text-stone-400">Comes from: {it.source}</p>}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
