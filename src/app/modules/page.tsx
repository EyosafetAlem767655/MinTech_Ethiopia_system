import Link from "next/link";
import { MINTECH_MODULES } from "@/lib/modules";

export default function ModulesPage() {
  return (
    <main className="max-w-6xl mx-auto px-4 pb-8">
      <header className="py-8">
        <p className="text-xs font-bold tracking-[0.24em] uppercase text-emerald-700">MinTech operating system</p>
        <h1 className="font-display text-3xl font-bold text-ink mt-2">Six modules</h1>
      </header>

      <section className="overflow-x-auto rounded-xl border border-emerald-200 bg-white">
        <table className="min-w-[880px] w-full text-left">
          <thead className="bg-emerald-700 text-white">
            <tr>
              <th className="w-20 px-4 py-4 text-sm font-bold">#</th>
              <th className="px-4 py-4 text-sm font-bold">Module</th>
              <th className="px-4 py-4 text-sm font-bold">Solves</th>
              <th className="px-4 py-4 text-sm font-bold">Main interface</th>
              <th className="w-28 px-4 py-4 text-sm font-bold">Open</th>
            </tr>
          </thead>
          <tbody>
            {MINTECH_MODULES.map((module) => (
              <tr key={module.code} className="border-t border-emerald-100 odd:bg-white even:bg-emerald-50/30">
                <td className="px-4 py-4 align-top font-display font-bold text-emerald-800">{module.code}</td>
                <td className="px-4 py-4 align-top font-semibold text-stone-900">{module.name}</td>
                <td className="px-4 py-4 align-top text-sm text-stone-600">{module.solves}</td>
                <td className="px-4 py-4 align-top text-sm text-stone-700">{module.mainInterface}</td>
                <td className="px-4 py-4 align-top">
                  <Link
                    href={module.href}
                    className="inline-flex rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-3 pt-5 sm:grid-cols-2 lg:grid-cols-3">
        {MINTECH_MODULES.map((module) => (
          <Link
            key={module.code}
            href={module.href}
            className="rounded-xl border border-stone-200 bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-bold text-white ${module.accent}`}>
              {module.code}
            </span>
            <h2 className="mt-3 font-display text-base font-bold text-ink">{module.name}</h2>
            <p className="mt-2 text-xs leading-relaxed text-stone-500">{module.mainInterface}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
