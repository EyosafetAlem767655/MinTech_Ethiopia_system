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
    if (res.ok) router.push(params.get("next") || "/");
    else setError("Wrong password. Try again.");
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
      <p className="text-white font-display font-bold text-2xl mb-6 tracking-wide">⛰ MinTech Ethiopia</p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
