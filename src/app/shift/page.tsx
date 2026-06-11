"use client";

import { useEffect, useState } from "react";

/** The 60-second end-of-shift form for the shift supervisor. */
export default function ShiftFormPage() {
  const [lots, setLots] = useState<{ _id: string; lotCode: string; supplier: string }[]>([]);
  const [form, setForm] = useState({
    supervisor: "",
    filledSacks: "",
    downtimeMinutes: "",
    shift: "day",
    notes: "",
    lotId: "",
  });
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/lots")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setLots(d))
      .catch(() => {});
    const saved = localStorage.getItem("mt_supervisor");
    if (saved) setForm((f) => ({ ...f, supervisor: saved }));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    localStorage.setItem("mt_supervisor", form.supervisor);
    const res = await fetch("/api/shift-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, filledSacks: Number(form.filledSacks), downtimeMinutes: Number(form.downtimeMinutes) || 0 }),
    });
    setBusy(false);
    if (res.ok) setDone(true);
  };

  if (done) {
    return (
      <main className="max-w-lg mx-auto min-h-[70vh] grid place-items-center px-6">
        <div className="text-center animate-scale-in">
          <div className="text-6xl mb-4">✅</div>
          <h1 className="font-display text-xl font-bold text-clay-900">Shift report saved</h1>
          <p className="text-sm text-stone-400 mt-2">It will appear in tomorrow&apos;s 6:30 AM brief.</p>
          <button
            onClick={() => {
              setDone(false);
              setForm((f) => ({ ...f, filledSacks: "", downtimeMinutes: "", notes: "" }));
            }}
            className="mt-6 bg-clay-700 text-white font-bold rounded-full px-6 py-3 text-sm"
          >
            Submit another
          </button>
        </div>
      </main>
    );
  }

  const field = "w-full rounded-xl border border-clay-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-clay-500 bg-white";

  return (
    <main className="max-w-lg mx-auto">
      <header className="hero-gradient text-white px-5 pt-10 pb-6 rounded-b-3xl">
        <h1 className="font-display text-xl font-bold">🏭 End-of-shift report</h1>
        <p className="text-clay-100/80 text-xs mt-1">Takes less than 60 seconds.</p>
      </header>
      <form onSubmit={submit} className="px-4 py-5 space-y-4 stagger">
        <div>
          <label className="text-xs font-bold text-clay-800 block mb-1.5">Your name</label>
          <input
            required
            value={form.supervisor}
            onChange={(e) => setForm({ ...form, supervisor: e.target.value })}
            placeholder="Supervisor name"
            className={field}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-clay-800 block mb-1.5">Filled sacks</label>
            <input
              required
              type="number"
              min={0}
              inputMode="numeric"
              value={form.filledSacks}
              onChange={(e) => setForm({ ...form, filledSacks: e.target.value })}
              placeholder="0"
              className={field}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-clay-800 block mb-1.5">Downtime (min)</label>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={form.downtimeMinutes}
              onChange={(e) => setForm({ ...form, downtimeMinutes: e.target.value })}
              placeholder="0"
              className={field}
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-bold text-clay-800 block mb-1.5">Shift</label>
          <div className="grid grid-cols-2 gap-2">
            {(["day", "night"] as const).map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => setForm({ ...form, shift: s })}
                className={`rounded-xl py-3 text-sm font-bold capitalize transition ${
                  form.shift === s ? "bg-clay-700 text-white" : "bg-white border border-clay-200 text-clay-700"
                }`}
              >
                {s === "day" ? "☀️ Day" : "🌙 Night"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-bold text-clay-800 block mb-1.5">Bag lot used (optional)</label>
          <select value={form.lotId} onChange={(e) => setForm({ ...form, lotId: e.target.value })} className={field}>
            <option value="">— none —</option>
            {lots.map((l) => (
              <option key={l._id} value={l._id}>
                {l.lotCode} ({l.supplier})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-clay-800 block mb-1.5">Notes (optional)</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2}
            placeholder="Breakdowns, incidents, anything unusual…"
            className={field}
          />
        </div>
        <button
          disabled={busy}
          className="w-full bg-clay-700 hover:bg-clay-800 text-white font-bold rounded-xl py-3.5 text-sm transition active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "Saving…" : "Submit shift report"}
        </button>
      </form>
    </main>
  );
}
