"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The checks the AI never managed to run — and the button that runs them.
 *
 * A submission whose photo check failed is saved anyway: the figures are
 * counted, the reporter is thanked, and the verdict is recorded as "did not
 * run" rather than as a suspicion. That is deliberate. What was missing is this
 * screen — the list of those gaps, so a provider outage costs a few hours of
 * verdicts instead of losing them permanently.
 *
 * Re-running writes a verdict and nothing else. No figure, date or author on any
 * report can move from here, which is why the button can sit in plain sight.
 */

interface Pending {
  kind: "purchase_request" | "pp_bag_damage";
  id: string;
  label: string;
  by: string;
  at: string | null;
  reason: string;
}

const when = (at: string | null) =>
  at ? new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default function AiRecheckPanel() {
  const [rows, setRows] = useState<Pending[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/ai-recheck");
      const d = await r.json();
      setRows(Array.isArray(d?.rows) ? d.rows : []);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = useCallback(async (p: Pending) => {
    setBusy(p.id);
    setError("");
    try {
      const r = await fetch("/api/ai-recheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: p.kind, id: p.id }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ran) {
        // Named, not swallowed: "it is still down" and "this one has no photo"
        // are different answers and lead to different next steps.
        setError(d?.error || "The check could not be run. The model may still be unreachable.");
        setDone((m) => ({ ...m, [p.id]: "failed" }));
        return;
      }
      setDone((m) => ({ ...m, [p.id]: "checked" }));
      // Off the list, but only this row — reloading the whole list here would
      // throw away the results of the run in progress beside it.
      setRows((list) => (list || []).filter((x) => x.id !== p.id));
    } catch {
      setError("The check could not be run.");
    } finally {
      setBusy(null);
    }
  }, []);

  const runAll = useCallback(async () => {
    // One at a time. Twenty photos fired at one provider at once is how the
    // outage this screen exists for happens in the first place.
    for (const p of [...(rows || [])]) {
      await run(p);
    }
  }, [rows, run]);

  if (rows === null) return <div className="card h-20 animate-pulse bg-clay-50" />;

  if (rows.length === 0) {
    const checked = Object.values(done).filter((v) => v === "checked").length;
    return (
      <p className="card p-3 text-[11px] text-stone-500">
        ✅ Every submission has an AI verdict.
        {checked > 0 ? ` ${checked} re-checked just now.` : ""}
      </p>
    );
  }

  return (
    <section className="card space-y-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-bold">⏳ AI checks that did not run</h3>
          <p className="text-[11px] text-stone-500">
            These submissions are saved and counted — only the photo verdict is missing.
          </p>
        </div>
        <button
          type="button"
          onClick={runAll}
          disabled={busy !== null}
          className="rounded-full bg-clay-700 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-clay-800 disabled:opacity-50"
        >
          {busy ? "Checking…" : `Re-run all ${rows.length}`}
        </button>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-[11px] text-red-700">{error}</p>}

      <ul className="divide-y divide-clay-50">
        {rows.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-stone-800">{p.label}</p>
              <p className="text-[10px] text-stone-400">
                {p.by} · {when(p.at)} · {p.reason}
              </p>
            </div>
            <button
              type="button"
              onClick={() => run(p)}
              disabled={busy !== null}
              className="shrink-0 rounded-full border border-clay-200 px-2.5 py-1 text-[11px] font-bold text-clay-800 transition hover:bg-clay-50 disabled:opacity-50"
            >
              {busy === p.id ? "Checking…" : "Re-run"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
