import Link from "next/link";

/**
 * A page that is not there.
 *
 * Distinct from the offline page (public/offline.html) on purpose: this one
 * means the app is reachable and the address is wrong, which needs a way back
 * rather than a suggestion to check the connection.
 */
export default function NotFound() {
  return (
    <main className="app-shell flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <span className="text-5xl">🧭</span>
      <h1 className="mt-4 font-display text-2xl font-bold text-clay-900">That page is not here</h1>
      <p className="mt-2 max-w-sm text-sm text-stone-500">
        The address may have changed, or the link that brought you here is out of date. Nothing has been lost —
        every report is still where it was.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-full bg-clay-700 px-5 py-2.5 text-sm font-bold text-white transition-all active:scale-95"
      >
        ← Back to the Brief
      </Link>
    </main>
  );
}
