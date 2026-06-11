"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Worker damage-claim form.
 * Evidence rules enforced client-side:
 *  - capture="environment" forces the live camera on phones (no gallery picker)
 *  - GPS, timestamp, device id and worker identity are recorded
 *  - a visible watermark is burned into the image before upload
 */
export default function NewClaimPage() {
  const [lots, setLots] = useState<{ _id: string; lotCode: string; supplier: string; bagType: string }[]>([]);
  const [worker, setWorker] = useState("");
  const [lotId, setLotId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [shift, setShift] = useState("day");
  const [photos, setPhotos] = useState<{ blob: Blob; preview: string }[]>([]);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ flags: string[]; ai?: { damage_severity: string; suspicious: boolean } } | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/lots")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setLots(d))
      .catch(() => {});
    const saved = localStorage.getItem("mt_worker");
    if (saved) setWorker(saved);
    if (!localStorage.getItem("mt_device_id")) {
      localStorage.setItem("mt_device_id", crypto.randomUUID());
    }
    navigator.geolocation?.getCurrentPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  const watermark = async (file: File): Promise<Blob> => {
    const bmp = await createImageBitmap(file);
    const maxW = 1600;
    const scale = Math.min(1, maxW / bmp.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);

    const lot = lots.find((l) => l._id === lotId);
    const deviceId = localStorage.getItem("mt_device_id") || "unknown";
    const lines = [
      `MINTECH EVIDENCE · ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`,
      `Worker: ${worker || "?"} · Device: ${deviceId.slice(0, 8)} · Lot: ${lot?.lotCode || "?"}`,
      gps ? `GPS: ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : "GPS: unavailable",
    ];
    const fs = Math.max(14, Math.round(canvas.width / 55));
    const pad = fs * 0.6;
    const boxH = lines.length * (fs * 1.35) + pad * 2;
    ctx.fillStyle = "rgba(62, 22, 13, 0.65)";
    ctx.fillRect(0, canvas.height - boxH, canvas.width, boxH);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${fs}px sans-serif`;
    lines.forEach((line, i) => {
      ctx.fillText(line, pad, canvas.height - boxH + pad + fs * (i + 0.9));
    });
    // Diagonal anti-tamper stamp
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-Math.PI / 8);
    ctx.font = `bold ${fs * 2.2}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.textAlign = "center";
    ctx.fillText("MINTECH ETHIOPIA", 0, 0);
    ctx.restore();

    return new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b || file), "image/jpeg", 0.82)
    );
  };

  const onCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const blob = await watermark(file);
    setPhotos((p) => [...p, { blob, preview: URL.createObjectURL(blob) }]);
    e.target.value = "";
  };

  const submit = async () => {
    setError("");
    if (!worker || !lotId || !quantity || photos.length === 0) {
      setError("Please fill your name, lot, quantity, and take at least one live photo.");
      return;
    }
    setBusy(true);
    localStorage.setItem("mt_worker", worker);
    const fd = new FormData();
    fd.set("lotId", lotId);
    fd.set("quantity", quantity);
    fd.set("worker", worker);
    fd.set("shift", shift);
    fd.set("deviceId", localStorage.getItem("mt_device_id") || "");
    if (gps) {
      fd.set("lat", String(gps.lat));
      fd.set("lng", String(gps.lng));
    }
    photos.forEach((p, i) => fd.append("photos", p.blob, `claim-${i}.jpg`));
    try {
      const res = await fetch("/api/claims", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      setResult(json);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
    setBusy(false);
  };

  if (result) {
    const suspicious = result.flags.some((f) => f === "suspicious_image" || f === "duplicate_photo");
    return (
      <main className="max-w-lg mx-auto min-h-[70vh] grid place-items-center px-6">
        <div className="text-center animate-scale-in">
          <div className="text-6xl mb-4">{suspicious ? "🔍" : "✅"}</div>
          <h1 className="font-display text-xl font-bold text-clay-900">Claim submitted</h1>
          <p className="text-sm text-stone-500 mt-2">
            AI check: damage severity <b>{result.ai?.damage_severity || "n/a"}</b>
            {suspicious && (
              <>
                <br />
                ⚠️ The photo was flagged ({result.flags.join(", ")}) and will get extra review.
              </>
            )}
          </p>
          <button
            onClick={() => {
              setResult(null);
              setPhotos([]);
              setQuantity("");
            }}
            className="mt-6 bg-clay-700 text-white font-bold rounded-full px-6 py-3 text-sm"
          >
            Report another
          </button>
        </div>
      </main>
    );
  }

  const field = "w-full rounded-xl border border-clay-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-clay-500 bg-white";

  return (
    <main className="max-w-lg mx-auto">
      <header className="hero-gradient text-white px-5 pt-10 pb-6 rounded-b-3xl">
        <h1 className="font-display text-xl font-bold">📸 Report damaged bags</h1>
        <p className="text-clay-100/80 text-xs mt-1">
          Live camera only — gallery uploads are disabled. GPS, time and device are recorded.
        </p>
      </header>

      <div className="px-4 py-5 space-y-4 stagger">
        <input
          value={worker}
          onChange={(e) => setWorker(e.target.value)}
          placeholder="Your name"
          className={field}
        />
        <select value={lotId} onChange={(e) => setLotId(e.target.value)} className={field}>
          <option value="">Select bag lot…</option>
          {lots.map((l) => (
            <option key={l._id} value={l._id}>
              {l.lotCode} · {l.supplier} · {l.bagType}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="Damaged bags"
            className={field}
          />
          <select value={shift} onChange={(e) => setShift(e.target.value)} className={field}>
            <option value="day">☀️ Day shift</option>
            <option value="night">🌙 Night shift</option>
          </select>
        </div>

        {/* capture="environment" forces the camera — no gallery access */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onCapture}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-full border-2 border-dashed border-clay-300 rounded-2xl py-8 text-clay-700 font-bold text-sm bg-clay-50/50 hover:bg-clay-50 transition active:scale-[0.98]"
        >
          📷 Open camera & take evidence photo
        </button>

        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <div key={i} className="relative animate-scale-in">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt={`evidence ${i + 1}`} className="rounded-xl aspect-square object-cover" />
                <button
                  onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 bg-clay-800 text-white rounded-full w-6 h-6 text-xs"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] text-stone-400">
          {gps ? `📍 Location locked: ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : "📍 Getting location…"} · Photos
          are watermarked and checked by AI for authenticity.
        </p>

        {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}

        <button
          onClick={submit}
          disabled={busy}
          className="w-full bg-clay-700 hover:bg-clay-800 text-white font-bold rounded-xl py-3.5 text-sm transition active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "Uploading & running AI checks…" : "Submit damage claim"}
        </button>
      </div>
    </main>
  );
}
