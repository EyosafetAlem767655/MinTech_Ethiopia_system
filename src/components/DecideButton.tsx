"use client";

/**
 * The review button used by every panel that carries a human decision — PP bag
 * damage, damage claims and tool purchase requests.
 *
 * Shared so the three review surfaces cannot drift into looking like three
 * different kinds of action when they are the same one.
 */

const TONES: Record<string, string> = {
  green: "bg-green-600 hover:bg-green-700 text-white",
  red: "bg-red-500 hover:bg-red-600 text-white",
  blue: "bg-blue-600 hover:bg-blue-700 text-white",
  purple: "bg-purple-600 hover:bg-purple-700 text-white",
  grey: "bg-stone-200 hover:bg-stone-300 text-stone-700",
};

export default function DecideBtn({
  label,
  tone = "grey",
  busy = false,
  disabled = false,
  title,
  onClick,
}: {
  label: string;
  tone?: keyof typeof TONES | string;
  busy?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      title={title}
      className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition-all active:scale-95 disabled:opacity-50 ${
        TONES[tone] || TONES.grey
      }`}
    >
      {busy ? "…" : label}
    </button>
  );
}
