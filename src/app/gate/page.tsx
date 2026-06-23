"use client";

import { useCallback, useEffect, useState } from "react";

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

export default function GatePage() {
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
    <main className="max-w-6xl mx-auto px-4 pb-8">
      <header className="hero-gradient -mx-4 px-5 pb-7 pt-10 text-white sm:mx-0 sm:mt-4 sm:rounded-2xl">
        <p className="text-xs font-bold tracking-[0.24em] uppercase text-clay-100">M6</p>
        <h1 className="font-display text-2xl font-bold">Truck & Raw-Material Traceability</h1>
        <p className="mt-1 text-sm text-clay-100/90">Truck evidence, quarry source and AI stone quality history.</p>
      </header>

      <section className="grid gap-3 py-5 sm:grid-cols-3">
        <Metric label="Loads logged" value={totalLoads.toLocaleString()} />
        <Metric label="Fair loads" value={fairLoads.toLocaleString()} tone="text-amber-700" />
        <Metric label="Dark/weathered loads" value={badLoads.toLocaleString()} tone="text-red-700" />
      </section>

      <section className="rounded-xl border border-stone-200 bg-white">
        <div className="flex items-center justify-between border-b border-stone-100 p-4">
          <h2 className="font-display text-base font-bold text-ink">Traceability log</h2>
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
                  <h3 className="font-bold text-stone-900">{delivery.truckPlate}</h3>
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
      </section>
    </main>
  );
}

function Metric({ label, value, tone = "text-stone-900" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-widest text-stone-400">{label}</p>
      <p className={`mt-2 font-display text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}
