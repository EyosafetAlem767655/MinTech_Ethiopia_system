"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BAG_KINDS,
  BAG_SIZES,
  BAG_SIZE_LABEL,
  bagGrandTotal,
  bagKindCount,
  bagLabel,
  bagSizeTotals,
  type BagCounts,
} from "@/lib/products";

/**
 * PP bags bought: what arrived, and what was paid for it.
 *
 * Two departments file against this table and they file different halves. Asset
 * management counts the delivery — six kinds, by size and colour — and that count
 * is what the monthly finance report reads. Finance files the receipt and the
 * money, with no counts at all.
 *
 * Both copies are listed together and labelled, because the gaps are the useful
 * part: a receipt with no count means nobody checked the delivery, and a count
 * with no receipt means the money side is unrecorded. Hiding either would hide
 * exactly the thing worth looking at.
 */

interface ReceiptCheck {
  checked: boolean;
  score: number;
  printedTotal: number | null;
  mismatches: string[];
}

interface Extraction {
  checked: boolean;
  confidence: number;
  notes: string;
  unmatched: string[];
  filled: string[];
}

interface Row {
  _id: string;
  date: string;
  bags: BagCounts | null;
  supplier: string | null;
  dnNo: string | null;
  currency: "ETB" | "USD";
  totalAmount: number | null;
  reportedBy: string;
  filedByDept: "asset" | "finance";
  photoFileIds: string[];
  receiptCheck: ReceiptCheck | null;
  extraction: Extraction | null;
}

const fmt = (n: number | null | undefined, dp = 2) =>
  n == null ? "—" : (Math.round(n * 10 ** dp) / 10 ** dp).toLocaleString(undefined, { maximumFractionDigits: dp });
const count = (n: number) => (n ? n.toLocaleString() : "");
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export default function PpBagPurchasePanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [usdRate, setUsdRate] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/asset/pp-bag-purchases")
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d) => {
        setRows(Array.isArray(d.rows) ? d.rows : []);
        setUsdRate(d.usdRate ?? null);
      })
      .catch(() => setRows([]));
  }, []);

  const totals = useMemo(() => {
    const bySize = { kg25: 0, kg40: 0 } as Record<string, number>;
    const byKind = new Map<string, number>();
    let etb = 0;
    let usd = 0;
    for (const r of rows || []) {
      const sizes = bagSizeTotals(r.bags);
      for (const size of BAG_SIZES) bySize[size] += sizes[size];
      for (const { size, colour } of BAG_KINDS) {
        const k = `${size}-${colour}`;
        byKind.set(k, (byKind.get(k) || 0) + bagKindCount(r.bags, size, colour));
      }
      if (r.currency === "USD") usd += r.totalAmount || 0;
      else etb += r.totalAmount || 0;
    }
    return { bySize, byKind, etb, usd };
  }, [rows]);

  if (!rows) return <div className="card h-40 animate-pulse bg-clay-50" />;

  // Converted at the month's published rate, the same figure the finance tab
  // uses. With no rate filed, each currency is shown on its own rather than
  // inventing one.
  const totalEtb = usdRate ? totals.etb + totals.usd * usdRate : null;
  const totalUsd = usdRate ? totals.usd + totals.etb / usdRate : null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">🧺 PP bags bought</h2>
        <p className="text-[11px] text-stone-400">
          {rows.length} report{rows.length === 1 ? "" : "s"} · counts in pieces
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">No PP bag purchases recorded yet.</p>
      ) : (
        <>
          <div className="card max-h-[26rem] overflow-auto p-0">
            <table className="w-full min-w-[900px] text-right text-xs">
              <thead className="sticky top-0 z-10 bg-clay-50 text-[10px] uppercase tracking-wide text-stone-500 shadow-[0_1px_0_#f3e3dd]">
                <tr>
                  <th className="p-2 text-left font-bold">Date</th>
                  {BAG_KINDS.map(({ size, colour }) => (
                    <th key={`${size}-${colour}`} className="border-l border-clay-100 p-2 font-bold">
                      {bagLabel(size, colour)}
                    </th>
                  ))}
                  <th className="border-l border-clay-100 p-2 font-bold">Total</th>
                  <th className="p-2 text-left font-bold">Supplier</th>
                  <th className="p-2 text-left font-bold">D.N No.</th>
                  <th className="p-2 font-bold">Amount</th>
                  <th className="p-2 font-bold">Receipt</th>
                  <th className="p-2 text-left font-bold">Filed by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const bags = bagGrandTotal(r.bags);
                  return (
                    <tr key={r._id} className="border-t border-clay-50">
                      <td className="p-2 text-left font-semibold text-stone-800">{fmtDate(r.date)}</td>
                      {BAG_KINDS.map(({ size, colour }) => (
                        <td
                          key={`${size}-${colour}`}
                          className="border-l border-clay-50 p-2 tabular-nums text-stone-700"
                        >
                          {count(bagKindCount(r.bags, size, colour))}
                        </td>
                      ))}
                      <td className="border-l border-clay-50 p-2 font-bold tabular-nums text-clay-900">
                        {bags ? count(bags) : "—"}
                      </td>
                      <td className="p-2 text-left text-stone-600">{r.supplier || "—"}</td>
                      <td className="p-2 text-left text-stone-500">{r.dnNo || "—"}</td>
                      <td className="p-2 font-bold tabular-nums text-clay-900">
                        {fmt(r.totalAmount)}{" "}
                        <span className="text-[10px] font-normal text-stone-400">{r.currency}</span>
                      </td>
                      <td className="p-2">
                        <ReceiptCell row={r} />
                      </td>
                      <td className="p-2 text-left">
                        <DeptTag row={r} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 bg-clay-50 shadow-[0_-1px_0_#f3e3dd]">
                <tr className="font-bold">
                  <td className="p-2 text-left">Total</td>
                  {BAG_KINDS.map(({ size, colour }) => (
                    <td key={`${size}-${colour}`} className="border-l border-clay-100 p-2 tabular-nums">
                      {count(totals.byKind.get(`${size}-${colour}`) || 0)}
                    </td>
                  ))}
                  <td className="border-l border-clay-100 p-2 tabular-nums text-clay-900">
                    {count(totals.bySize.kg25 + totals.bySize.kg40)}
                  </td>
                  <td className="p-2" colSpan={5} />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="card grid grid-cols-2 gap-3 p-4">
            {BAG_SIZES.map((size) => (
              <div key={size}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">
                  {BAG_SIZE_LABEL[size]} PP bags
                </p>
                <p className="font-display text-xl font-bold text-clay-900">{count(totals.bySize[size]) || "0"}</p>
              </div>
            ))}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Spent in birr</p>
              <p className="font-display text-xl font-bold text-clay-900">
                {totalEtb == null ? `${fmt(totals.etb)} ETB` : `${fmt(totalEtb)} ETB`}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Spent in dollars</p>
              <p className="font-display text-xl font-bold text-clay-900">
                {totalUsd == null ? `${fmt(totals.usd)} USD` : `${fmt(totalUsd)} USD`}
              </p>
            </div>
            <p className="col-span-2 text-[11px] leading-snug text-stone-400">
              {usdRate
                ? `Converted at ${fmt(usdRate)} ETB per USD, from this month's price list.`
                : "No USD rate on this month's price list yet, so each currency is totalled on its own rather than guessing a rate."}{" "}
              Quantities come from the asset-management reports; finance-filed rows carry the receipt only.
            </p>
          </div>
        </>
      )}
    </section>
  );
}

/** Which department's copy this is, and whether the AI read the paperwork. */
function DeptTag({ row }: { row: Row }) {
  const asset = row.filedByDept === "asset";
  return (
    <div className="flex flex-col items-start gap-1">
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
          asset ? "bg-clay-100 text-clay-800" : "bg-stone-100 text-stone-600"
        }`}
      >
        {asset ? "🧺 Asset" : "🧾 Finance"}
      </span>
      <span className="text-[10px] text-stone-400">{row.reportedBy}</span>
      {row.extraction?.checked && (
        <span
          title={
            row.extraction.unmatched.length > 0
              ? `Not recognised: ${row.extraction.unmatched.join(" · ")}`
              : row.extraction.notes || undefined
          }
          className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-600"
        >
          🤖 read {row.extraction.confidence}%
          {row.extraction.unmatched.length > 0 ? ` · ${row.extraction.unmatched.length} unread` : ""}
        </span>
      )}
    </div>
  );
}

/** The receipt photos plus the total cross-check, or an honest blank. */
function ReceiptCell({ row }: { row: Row }) {
  const c = row.receiptCheck;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        {row.photoFileIds.slice(0, 3).map((id) => (
          <a key={id} href={`/api/files/${id}`} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${id}`} alt="Receipt" className="h-9 w-9 rounded object-cover ring-1 ring-clay-100" />
          </a>
        ))}
        {row.photoFileIds.length === 0 && <span className="text-stone-300">—</span>}
      </div>
      {c &&
        (!c.checked ? (
          // Never red: a check that could not run is not an accusation.
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-600">
            ⏳ Not checked
          </span>
        ) : c.mismatches.length > 0 ? (
          <span
            title={c.mismatches.join(" · ")}
            className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800"
          >
            ⚠️ {fmt(c.printedTotal)} on receipt
          </span>
        ) : (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
            ✅ {c.score}%
          </span>
        ))}
    </div>
  );
}
