"use client";

import { useEffect, useRef, useState } from "react";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "How were collections this week?",
  "Which clients are overdue?",
  "Any suspicious damage claims?",
  "Compare this month's production to last month",
];

interface Quota {
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState<Quota | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  // Show the allowance up front. Being told "0 left" only after typing out a
  // question is a worse experience than seeing the budget the whole time.
  useEffect(() => {
    fetch("/api/chat")
      .then((r) => (r.ok ? r.json() : null))
      .then((q) => q && setQuota(q))
      .catch(() => {});
  }, []);

  const exhausted = quota != null && quota.remaining <= 0;

  const send = async (text: string) => {
    if (!text.trim() || busy || exhausted) return;
    const next: Msg[] = [...messages, { role: "user", content: text.trim() }];
    setMessages(next);
    setInput("");
    setBusy(true);
    // Never let the UI hang forever: abort the request if the server hasn't
    // responded in time (it should fail much sooner via its own timeouts).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 65000);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
        signal: ctrl.signal,
      });
      const json = await res.json();
      if (json.quota) setQuota(json.quota);
      setMessages([...next, { role: "assistant", content: json.reply || json.error || "No reply." }]);
    } catch (e) {
      const msg =
        e instanceof DOMException && e.name === "AbortError"
          ? "⚠️ The assistant took too long to respond. Please try again."
          : "⚠️ Network error — please try again.";
      setMessages([...next, { role: "assistant", content: msg }]);
    } finally {
      clearTimeout(timer);
    }
    setBusy(false);
  };

  return (
    <main className="max-w-lg mx-auto flex flex-col min-h-screen">
      <header className="hero-gradient text-white px-5 pt-10 pb-6 rounded-b-3xl">
        <h1 className="font-display text-xl font-bold">💬 Company Assistant</h1>
        <p className="text-clay-100/80 text-xs mt-1">
          Ask anything — it queries live production, sales, money and bag-control data.
        </p>
        {quota && (
          <p className="mt-2 text-[11px] font-bold text-clay-100/70">
            {exhausted
              ? "No questions left today — resets at midnight (EAT)."
              : `${quota.remaining} of ${quota.limit} questions left today`}
          </p>
        )}
      </header>

      <div className="flex-1 px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="stagger space-y-2 pt-4">
            <p className="text-xs text-stone-400 text-center mb-3">Try one of these:</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="block w-full text-left card px-4 py-3 text-sm text-clay-800 hover:bg-clay-50 transition active:scale-[0.98]"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex animate-fade-up ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                m.role === "user"
                  ? "bg-clay-700 text-white rounded-br-md"
                  : "card text-stone-700 rounded-bl-md"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="card rounded-2xl rounded-bl-md px-4 py-3 text-sm text-stone-400">
              <span className="inline-flex gap-1">
                <span className="animate-bounce">●</span>
                <span className="animate-bounce [animation-delay:0.15s]">●</span>
                <span className="animate-bounce [animation-delay:0.3s]">●</span>
              </span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-20 px-4 pb-2"
      >
        <div className="glass rounded-full flex items-center gap-2 pl-4 pr-1.5 py-1.5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={exhausted}
            placeholder={exhausted ? "Daily limit reached" : "Ask about the company…"}
            className="flex-1 bg-transparent text-sm focus:outline-none disabled:opacity-60"
          />
          <button
            disabled={busy || exhausted || !input.trim()}
            className="bg-clay-700 text-white rounded-full w-9 h-9 grid place-items-center text-sm font-bold disabled:opacity-40 transition active:scale-90"
          >
            ↑
          </button>
        </div>
      </form>
    </main>
  );
}
