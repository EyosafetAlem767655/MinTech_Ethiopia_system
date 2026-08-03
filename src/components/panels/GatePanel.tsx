"use client";

import { useCallback, useEffect, useState } from "react";

/** M6 truck & raw-material traceability. Folded into the Production department
 *  page (was /gate). */

type Grade = "good" | "fair" | "dark/weathered";

interface StoneDelivery {
  _id: string;
  truckPlate: string;
  supplier?: string;
  quarry?: string;
  driverName?: string;
  gateClerk?: string;
  loads: number;
  qualityGrade: Grade;
  photoFileId?: string;
  aiScore?: {
    visible_stone: boolean;
    qualityGrade: Grade;
    confidence: number;
    reasons: string[];
    recommendation?: string;
  };
  notes?: string;
  date: string;
}

interface GateData {
  deliveries: StoneDelivery[];
  summary: { _id: Grade; loads: number; count: number }[];
}

const gradeStyle: Record<Grade, string> = {
  good: "bg-green-100 text-green-700",
  fair: "bg-amber-100 text-amber-800",
  "dark/weathered": "bg-red-100 text-red-700",
};

export default function GatePanel() {
  const [data, setData] = useState<GateData | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/stone-deliveries");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const summary = data?.summary || [];
  const totalLoads = summary.reduce((sum, row) => sum + (row.loads || 0), 0);
  const badLoads = summary.find((row) => row._id === "dark/weathered")?.loads || 0;
  const fairLoads = summary.find((row) => row._id === "fair")?.loads || 0;

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-bold px-1">🚚 Gate & stone traceability</h2>

      <section className="grid grid-cols-3 gap-2">
        <Metric label="Loads logged" value={totalLoads.toLocaleString()} />
        <Metric label="Fair loads" value={fairLoads.toLocaleString()} tone="text-amber-700" />
        <Metric label="Dark/weathered" value={badLoads.toLocaleString()} tone="text-red-700" />
      </section>

      <div className="rounded-xl border border-stone-200 bg-white">
        <div className="flex items-center justify-between border-b border-stone-100 p-4">
          <h3 className="font-display text-sm font-bold text-ink">Traceability log</h3>
          <span className="text-xs font-semibold text-stone-400">{data?.deliveries.length || 0} records</span>
        </div>
        <div className="divide-y divide-stone-100">
          {data?.deliveries.map((delivery) => (
            <article key={delivery._id} className="flex gap-3 p-4">
              {delivery.photoFileId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/files/${delivery.photoFileId}`} alt="" className="h-16 w-16 rounded-lg object-cover" />
              ) : (
                <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-stone-100 text-xs font-bold text-stone-600">
                  Gate
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-bold text-stone-900">{delivery.truckPlate}</h4>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${gradeStyle[delivery.qualityGrade]}`}>
                    {delivery.qualityGrade}
                  </span>
                </div>
                <p className="mt-1 text-xs text-stone-500">
                  {delivery.loads} load(s) {delivery.quarry ? `from ${delivery.quarry}` : ""}
                  {delivery.supplier ? ` - ${delivery.supplier}` : ""}
                </p>
                <p className="mt-1 text-[11px] text-stone-400">
                  {new Date(delivery.date).toLocaleString()} {delivery.gateClerk ? `by ${delivery.gateClerk}` : ""}
                </p>
                {(delivery.aiScore?.reasons?.length || 0) > 0 && (
                  <p className="mt-1 text-xs text-stone-500">{delivery.aiScore?.reasons?.join(", ")}</p>
                )}
              </div>
            </article>
          ))}
          {!data && <p className="p-6 text-center text-sm text-stone-400">Loading gate log...</p>}
          {data && data.deliveries.length === 0 && <p className="p-6 text-center text-sm text-stone-400">No truck check-ins yet.</p>}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value, tone = "text-stone-900" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">{label}</p>
      <p className={`mt-1 font-display text-lg font-bold ${tone}`}>{value}</p>
    </div>
  );
}
