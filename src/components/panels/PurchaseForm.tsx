"use client";

import { useEffect, useState } from "react";
import DecideBtn from "@/components/DecideButton";
import { PURCHASE_UNITS_BASE, priceBasisFor, purchaseAmounts } from "@/lib/purchase-price";

/**
 * The item-purchase form — the same questions the bot's 🛍 የዕቃ ግዢ asks.
 *
 * Opens when a purchase request is marked ✓ Bought (Asset Management, or
 * Finance → Purchase status), pre-filled from the request: the item, how many
 * and in what. Saving records the purchase AND marks the request bought, in one
 * transaction; closing it leaves the request as it was.
 *
 * The item is matched to the store list as it is typed: an exact match is
 * linked, otherwise the nearest names are offered, or "new".
 */

export interface PurchaseRequestRef {
  _id: string;
  title: string;
  quantity: number | null;
  unit?: string | null;
}

interface Suggestion {
  key: string;
  label: string;
  unit: string;
}

const today = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

/** "pack" on an old request is the form's "pak". */
const asUnit = (u: string | null | undefined) => {
  const s = String(u || "").trim().toLowerCase();
  if (!s) return "pcs";
  return /^(pack|packet|pkt)$/.test(s) ? "pak" : s;
};

export default function PurchaseForm({
  request,
  onClose,
  onSaved,
}: {
  request?: PurchaseRequestRef | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [date, setDate] = useState(today());
  const [itemName, setItemName] = useState(request?.title ?? "");
  const [itemKey, setItemKey] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [exact, setExact] = useState<Suggestion | null>(null);
  const [similar, setSimilar] = useState<Suggestion[]>([]);
  const [qty, setQty] = useState(request?.quantity != null ? String(request.quantity) : "");
  const [unit, setUnit] = useState(asUnit(request?.unit));
  const [figure, setFigure] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Match the name to the store list, a moment after typing stops.
  useEffect(() => {
    const name = itemName.trim();
    if (!name) {
      setExact(null);
      setSimilar([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/finance/purchases?suggest=${encodeURIComponent(name)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const ex: Suggestion | null = d?.exact ?? null;
          setExact(ex);
          setSimilar(Array.isArray(d?.similar) ? d.similar : []);
          // An exact match links itself; anything else waits for a pick.
          if (ex) {
            setItemKey(ex.key);
            setIsNew(false);
          } else {
            setItemKey((k) => (k && (d?.similar ?? []).some((s: Suggestion) => s.key === k) ? k : null));
          }
        })
        .catch(() => undefined);
    }, 350);
    return () => clearTimeout(t);
  }, [itemName]);

  // Escape closes, as every modal here does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const linked = exact?.key === itemKey ? exact : similar.find((s) => s.key === itemKey) ?? null;
  const units = linked && !PURCHASE_UNITS_BASE.includes(linked.unit as "pcs" | "pak")
    ? [linked.unit, ...PURCHASE_UNITS_BASE]
    : [...PURCHASE_UNITS_BASE];
  const basis = priceBasisFor(unit);
  const q = Number(qty) || 0;
  const f = Number(figure) || 0;
  const { unitPrice, total } = purchaseAmounts(q, basis, f);
  const decided = !!itemKey || isNew;
  const ready = itemName.trim() && q > 0 && f > 0 && decided && !!date;

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/finance/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: request?._id ?? null,
          date,
          itemName,
          itemKey,
          isNew: !itemKey && isNew,
          qty: q,
          unit,
          figure: f,
          note,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Could not save this purchase.");
        return;
      }
      await onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const chip = (active: boolean) =>
    `rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
      active ? "bg-clay-700 text-white" : "bg-clay-50 text-clay-700 hover:bg-clay-100"
    }`;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-base font-bold text-stone-900">🛍 Record the purchase</h3>
            <p className="text-[11px] text-stone-400">
              {request ? `For the request “${request.title}” — saving marks it bought.` : "An item finance bought."}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-600">
            ✕
          </button>
        </div>

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}

        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Date bought</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-stone-200 px-2 py-1.5 text-xs"
            />
          </label>

          <div>
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Item</span>
              <input
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="e.g. Ball bearing 6210"
                className="mt-1 w-full rounded-lg border border-stone-200 px-2 py-1.5 text-xs"
              />
            </label>
            {itemName.trim() && (
              <div className="mt-1.5 rounded-xl bg-stone-50 p-2">
                {exact ? (
                  <p className="text-[11px] text-green-700">
                    ✅ On the store list: <b>{exact.label}</b>
                  </p>
                ) : (
                  <>
                    <p className="mb-1.5 text-[11px] text-stone-500">
                      Not found exactly on the store list. Is it one of these, or a new item?
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {similar.map((s) => (
                        <button
                          key={s.key}
                          onClick={() => {
                            setItemKey(s.key);
                            setIsNew(false);
                          }}
                          className={chip(itemKey === s.key)}
                        >
                          {s.label}
                        </button>
                      ))}
                      <button
                        onClick={() => {
                          setItemKey(null);
                          setIsNew(true);
                        }}
                        className={chip(!itemKey && isNew)}
                      >
                        🆕 New item
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Quantity</span>
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                inputMode="decimal"
                className="mt-1 w-full rounded-lg border border-stone-200 px-2 py-1.5 text-xs"
              />
            </label>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Unit</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {[...new Set([...units, unit])].map((u) => (
                  <button key={u} onClick={() => setUnit(u)} className={chip(unit === u)}>
                    {u}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">
              {basis === "unit" ? "Price of one (ETB)" : "Total paid (ETB)"}
            </span>
            <input
              value={figure}
              onChange={(e) => setFigure(e.target.value)}
              inputMode="decimal"
              className="mt-1 w-full rounded-lg border border-stone-200 px-2 py-1.5 text-xs"
            />
            {q > 0 && f > 0 && (
              <span className="mt-1 block text-[11px] text-stone-500">
                {basis === "unit"
                  ? `Total: ${fmt(total)} ETB (${fmt(q)} × ${fmt(unitPrice)})`
                  : `Price of one ${unit}: ${fmt(unitPrice)} ETB (${fmt(total)} ÷ ${fmt(q)})`}
              </span>
            )}
          </label>

          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Note</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Supplier, receipt no.…"
              className="mt-1 w-full rounded-lg border border-stone-200 px-2 py-1.5 text-xs"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          <DecideBtn label="✓ Save purchase" tone="green" busy={busy} disabled={!ready} onClick={save} />
          <DecideBtn label="Cancel" tone="grey" busy={false} onClick={onClose} />
        </div>
        {!decided && itemName.trim() && !exact && (
          <p className="mt-2 text-[10px] text-stone-400">Pick the store item it is, or 🆕 New item, to save.</p>
        )}
      </div>
    </div>
  );
}
