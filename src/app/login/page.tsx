"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const params = useSearchParams();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) {
      router.push(params.get("next") || "/");
      return;
    }
    if (res.status === 401) {
      setError("Wrong password. Try again.");
    } else {
      const body = await res.json().catch(() => null);
      setError(body?.error || "Could not sign in. Please try again.");
    }
  };

  return (
    <form onSubmit={submit} className="card p-6 w-full max-w-sm animate-scale-in">
      <h1 className="font-display text-xl font-bold text-clay-900">Welcome back</h1>
      <p className="text-xs text-stone-400 mt-1 mb-4">Enter the team password to continue.</p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        autoFocus
        className="w-full rounded-xl border border-clay-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-clay-500"
      />
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      <button
        disabled={busy || !password}
        className="w-full mt-4 bg-clay-700 hover:bg-clay-800 text-white font-bold rounded-xl py-3 text-sm transition active:scale-[0.98] disabled:opacity-50"
      >
        {busy ? "Checking…" : "Enter dashboard"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen hero-gradient flex flex-col items-center justify-center px-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt="MinTech Ethiopia"
        className="mb-8 h-16 w-auto max-w-[80%] drop-shadow-[0_4px_14px_rgba(0,0,0,0.3)]"
      />
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
