"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [latest, setLatest] = useState<StoneDelivery | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/stone-deliveries");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setLatest(null);
    const fd = new FormData(e.currentTarget);
    if (photo) fd.set("photo", photo);
    const res = await fetch("/api/stone-deliveries", { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(json.error || "Could not save gate check-in");
      return;
    }
    setLatest(json.delivery);
    e.currentTarget.reset();
    setPhoto(null);
    setPreview("");
    load();
  };

  const summary = data?.summary || [];
  const totalLoads = summary.reduce((sum, row) => sum + (row.loads || 0), 0);
  const badLoads = summary.find((row) => row._id === "dark/weathered")?.loads || 0;
  const field =
    "w-full rounded-xl border border-clay-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-clay-500";

  return (
    <main className="max-w-6xl mx-auto px-4 pb-8">
      <header className="hero-gradient -mx-4 px-5 pb-7 pt-10 text-white sm:mx-0 sm:mt-4 sm:rounded-2xl">
        <p className="text-xs font-bold tracking-[0.24em] uppercase text-clay-100">M6</p>
        <h1 className="font-display text-2xl font-bold">Truck & Raw-Material Traceability</h1>
        <p className="mt-1 text-sm text-clay-100/90">Gate check-in with truck evidence and AI stone scoring.</p>
      </header>

      <section className="grid gap-3 py-5 sm:grid-cols-3">
        <Metric label="Loads logged" value={totalLoads.toLocaleString()} />
        <Metric label="Dark/weathered loads" value={badLoads.toLocaleString()} tone="text-red-700" />
        <Metric label="Recent trucks" value={String(data?.deliveries.length || 0)} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.76fr_1.24fr]">
        <form onSubmit={submit} className="rounded-xl border border-clay-100 bg-white p-4">
          <h2 className="font-display text-base font-bold text-ink">Gate check-in</h2>
          <div className="mt-4 space-y-3">
            <input name="truckPlate" required placeholder="Truck plate" className={field} />
            <div className="grid grid-cols-2 gap-3">
              <input name="loads" type="number" min={1} defaultValue={1} placeholder="Loads" className={field} />
              <select name="qualityGrade" className={field} defaultValue="">
                <option value="">AI decides</option>
                <option value="good">Good</option>
                <option value="fair">Fair</option>
                <option value="dark/weathered">Dark/weathered</option>
              </select>
            </div>
            <input name="supplier" placeholder="Supplier" className={field} />
            <input name="quarry" placeholder="Quarry/source" className={field} />
            <div className="grid grid-cols-2 gap-3">
              <input name="driverName" placeholder="Driver" className={field} />
              <input name="gateClerk" placeholder="Gate clerk" className={field} />
            </div>
            <textarea name="notes" rows={2} placeholder="Notes" className={field} />

            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onCapture} className="hidden" />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-xl border-2 border-dashed border-stone-300 bg-stone-50 py-6 text-sm font-bold text-stone-700"
            >
              Take stone photo
            </button>
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Stone preview" className="h-44 w-full rounded-xl object-cover" />
            )}
            {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
            <button disabled={saving} className="w-full rounded-xl bg-clay-700 py-3 text-sm font-bold text-white disabled:opacity-50">
              {saving ? "Scoring and saving..." : "Check in truck"}
            </button>
          </div>
        </form>

        <div className="space-y-4">
          {latest && <ScoreCard delivery={latest} />}
          <div className="rounded-xl border border-stone-200 bg-white">
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
          </div>
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

function ScoreCard({ delivery }: { delivery: StoneDelivery }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-stone-400">AI stone score</p>
          <h2 className="mt-1 font-display text-lg font-bold text-ink">{delivery.truckPlate}</h2>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${gradeStyle[delivery.qualityGrade]}`}>
          {delivery.qualityGrade}
        </span>
      </div>
      {delivery.aiScore ? (
        <div className="mt-3 text-sm text-stone-600">
          <p>Confidence: {Math.round(delivery.aiScore.confidence * 100)}%</p>
          {delivery.aiScore.reasons.length > 0 && <p className="mt-1">Reasons: {delivery.aiScore.reasons.join(", ")}</p>}
          {delivery.aiScore.recommendation && <p className="mt-1 font-semibold text-stone-800">{delivery.aiScore.recommendation}</p>}
        </div>
      ) : (
        <p className="mt-3 text-sm text-stone-500">Saved with manual grade.</p>
      )}
    </div>
  );
}
