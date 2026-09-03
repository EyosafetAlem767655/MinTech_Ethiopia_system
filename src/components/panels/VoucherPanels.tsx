"use client";

import { useEffect, useMemo, useState } from "react";
import { ledgerLabel } from "@/lib/products";

/**
 * The two paper vouchers, and whether they agree with the floor.
 *
 * Goods in (GRV), goods out (SIV), and the reconciliation between them and
 * production's daily bag count. The reconciliation is the reason both live on
 * one screen: neither half means much alone, and the gap between them is the
 * number worth looking at.
 */

interface ReceiptCheck {
  checked: boolean;
  score: number;
  printedTotal: number | null;
  mismatches: string[];
}

interface Item {
  voucherId: string;
  position: number;
  stockCode: string | null;
  description: string;
  unit: string | null;
  quantity: number | null;
  unitCost: number | null;
  totalAmount: number | null;
  ledgerKind: string | null;
  ledgerKey: string | null;
  ledgerQty: number | null;
}

interface Voucher {
  _id: string;
  voucherNo: string | null;
  date: string;
  supplier?: string | null;
  supplierInvoiceNo?: string | null;
  issuingStore?: string | null;
  issuedTo?: string | null;
  departmentSection?: string | null;
  requisitionNo?: string | null;
  currency?: "ETB" | "USD";
  totalAmount?: number | null;
  remarks?: string | null;
  receivedBy?: string | null;
  reportedBy: string;
  photoFileIds: string[];
  receiptCheck?: ReceiptCheck | null;
}

interface ReconRow {
  size: string;
  label: string;
  baseBalance: number;
  received: number;
  issued: number;
  expected: number;
  counted: number | null;
  gap: number | null;
}

interface Reconciliation {
  month: string;
  countedOn: string | null;
  rows: ReconRow[];
  discrepancies: ReconRow[];
}

interface Payload {
  grv: Voucher[];
  grvItems: Item[];
  siv: Voucher[];
  sivItems: Item[];
  reconciliation: Reconciliation | null;
  unavailable?: boolean;
}

const fmt = (n: number | null | undefined, dp = 2) =>
  n == null
    ? "—"
    : (Math.round(n * 10 ** dp) / 10 ** dp).toLocaleString(undefined, { maximumFractionDigits: dp });
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });

export default function VoucherPanels() {
  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<"grv" | "siv">("grv");

  useEffect(() => {
    fetch("/api/vouchers")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d ?? { grv: [], grvItems: [], siv: [], sivItems: [], reconciliation: null }))
      .catch(() => setData({ grv: [], grvItems: [], siv: [], sivItems: [], reconciliation: null }));
  }, []);

  const itemsByVoucher = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of [...(data?.grvItems ?? []), ...(data?.sivItems ?? [])]) {
      const list = map.get(it.voucherId) ?? [];
      list.push(it);
      map.set(it.voucherId, list);
    }
    return map;
  }, [data]);

  if (!data) return <div className="card h-64 animate-pulse bg-clay-50" />;

  const vouchers = tab === "grv" ? data.grv : data.siv;

  return (
    <div className="space-y-4">
      <Reconciliation recon={data.reconciliation} />

      <div className="flex gap-1.5 px-1">
        {(
          [
            ["grv", `📥 Goods received (${data.grv.length})`],
            ["siv", `📤 Store issues (${data.siv.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
              tab === key ? "bg-clay-700 text-white" : "bg-clay-50 text-clay-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {data.unavailable && (
        <p className="card p-3 text-xs text-amber-700">
          The voucher tables aren&apos;t in the database yet — apply migration 0019.
        </p>
      )}

      {vouchers.length === 0 ? (
        <p className="card p-4 text-sm text-stone-400">
          No {tab === "grv" ? "goods receiving" : "store issue"} vouchers filed yet.
        </p>
      ) : (
        <div className="space-y-2">
          {vouchers.map((v) => (
            <VoucherCard key={v._id} v={v} items={itemsByVoucher.get(v._id) ?? []} isGrv={tab === "grv"} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── reconciliation ─────────────────────────────── */

/**
 * Opening + received − issued, against what production actually counted.
 *
 * A null gap means nobody has counted this month, which is NOT the same as
 * everything agreeing — it says so rather than showing a reassuring dash.
 */
function Reconciliation({ recon }: { recon: Reconciliation | null }) {
  if (!recon) return null;
  const hasGaps = recon.discrepancies.length > 0;
  const counted = recon.rows.some((r) => r.counted !== null);

  return (
    <section className="card space-y-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-sm font-bold">📦 PP bag stock check · {recon.month}</h3>
        <p className="text-[11px] text-stone-400">
          {counted ? `Counted ${recon.countedOn}` : "Not counted this month"}
        </p>
      </div>

      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[420px] text-right text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-stone-500">
            <tr>
              <th className="p-1.5 text-left font-bold">Bag</th>
              <th className="p-1.5 font-bold">Opening</th>
              <th className="p-1.5 font-bold">Received</th>
              <th className="p-1.5 font-bold">Issued</th>
              <th className="p-1.5 font-bold">Expected</th>
              <th className="p-1.5 font-bold">Counted</th>
              <th className="p-1.5 font-bold">Gap</th>
            </tr>
          </thead>
          <tbody>
            {recon.rows.map((r) => (
              <tr key={r.size} className="border-t border-clay-50">
                <td className="p-1.5 text-left font-semibold text-stone-800">{r.label}</td>
                <td className="p-1.5 tabular-nums text-stone-500">{fmt(r.baseBalance, 0)}</td>
                <td className="p-1.5 tabular-nums text-stone-700">{fmt(r.received, 0)}</td>
                <td className="p-1.5 tabular-nums text-stone-700">{fmt(r.issued, 0)}</td>
                <td className="p-1.5 tabular-nums font-semibold text-stone-800">{fmt(r.expected, 0)}</td>
                <td className="p-1.5 tabular-nums text-stone-800">
                  {r.counted === null ? <span className="text-stone-300">—</span> : fmt(r.counted, 0)}
                </td>
                <td
                  className={`p-1.5 font-bold tabular-nums ${
                    r.gap === null ? "text-stone-300" : r.gap === 0 ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {r.gap === null ? "—" : `${r.gap > 0 ? "+" : ""}${fmt(r.gap, 0)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-snug text-stone-400">
        {!counted
          ? "Production has not filed a bag count this month, so there is nothing to check the vouchers against."
          : hasGaps
            ? "A gap means bags moved without a voucher, a voucher was filed twice, or the count is off. The counted figure is recorded as reported — nothing here changes it."
            : "The floor agrees with the vouchers."}{" "}
        Checked per size: the opening balance is filed by size, so a per-colour expectation would have
        no opening figure to start from.
      </p>
    </section>
  );
}

/* ──────────────────────────────── one voucher ─────────────────────────────── */

function VoucherCard({ v, items, isGrv }: { v: Voucher; items: Item[]; isGrv: boolean }) {
  const ledgerLines = items.filter((i) => i.ledgerKey);

  return (
    <div className="card space-y-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-clay-900">
            {isGrv ? "📥" : "📤"} No. {v.voucherNo || "—"}
          </p>
          <p className="text-[11px] text-stone-500">
            {fmtDate(v.date)} ·{" "}
            {isGrv
              ? v.supplier || "no supplier"
              : `${v.issuedTo || "—"}${v.departmentSection ? ` · ${v.departmentSection}` : ""}`}
          </p>
        </div>
        {isGrv && (
          <div className="text-right">
            <p className="text-sm font-bold tabular-nums text-clay-900">
              {fmt(v.totalAmount)} {v.currency}
            </p>
            <ReceiptBadge check={v.receiptCheck ?? null} />
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[460px] text-right text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="p-1.5 text-left font-bold">Description</th>
                <th className="p-1.5 font-bold">Unit</th>
                <th className="p-1.5 font-bold">Qty</th>
                {isGrv && <th className="p-1.5 font-bold">Unit cost</th>}
                <th className="p-1.5 text-left font-bold">Stock item</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={`${it.voucherId}-${it.position}`} className="border-t border-clay-50">
                  <td className="p-1.5 text-left text-stone-700">
                    {it.description}
                    {it.stockCode ? <span className="text-stone-400"> · {it.stockCode}</span> : null}
                  </td>
                  <td className="p-1.5 text-stone-500">{it.unit || "—"}</td>
                  <td className="p-1.5 tabular-nums text-stone-700">{fmt(it.quantity, 3)}</td>
                  {isGrv && <td className="p-1.5 tabular-nums text-stone-700">{fmt(it.unitCost)}</td>}
                  <td className="p-1.5 text-left">
                    {it.ledgerKey ? (
                      <span className="rounded-full bg-clay-50 px-2 py-0.5 text-[10px] font-bold text-clay-700">
                        {ledgerLabel(it.ledgerKind, it.ledgerKey)} · {fmt(it.ledgerQty, 3)}
                      </span>
                    ) : (
                      <span className="text-[10px] text-stone-300">not tracked</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ledgerLines.length === 0 && items.length > 0 && (
        <p className="text-[11px] text-stone-400">
          No line on this voucher was confirmed as a tracked stock item, so it does not move the bag
          balance.
        </p>
      )}

      {v.remarks && <p className="text-[11px] italic text-stone-500">“{v.remarks}”</p>}

      <div className="flex flex-wrap items-center gap-1.5">
        {(v.photoFileIds ?? []).map((id) => (
          <a key={id} href={`/api/files/${id}`} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/files/${id}`}
              alt="Voucher"
              className="h-9 w-9 rounded object-cover ring-1 ring-clay-100"
            />
          </a>
        ))}
        <span className="ml-auto text-[10px] text-stone-400">
          {v.reportedBy}
          {v.receivedBy ? ` · received by ${v.receivedBy}` : ""}
        </span>
      </div>
    </div>
  );
}

/**
 * The receipt cross-check.
 *
 * Never red when the check has not run: "we could not read it" is its own
 * outcome and must not look like an accusation about the paperwork.
 */
function ReceiptBadge({ check }: { check: ReceiptCheck | null }) {
  if (!check) return <span className="text-[10px] text-stone-400">receipt not checked</span>;
  if (!check.checked) return <span className="text-[10px] text-stone-400">check unavailable</span>;
  if (check.mismatches.length > 0) {
    return (
      <span className="text-[10px] font-bold text-red-700" title={check.mismatches.join("; ")}>
        ⚠️ total disagrees
      </span>
    );
  }
  return <span className="text-[10px] font-bold text-green-700">✓ matches receipt</span>;
}
