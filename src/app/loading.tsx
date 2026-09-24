import { CardSkeleton, TileSkeleton } from "@/components/Skeleton";

/**
 * The Brief, while it is on its way.
 *
 * Shaped like the real page — hero band, then the exception card, then the
 * department summaries — so a slow connection shows the page arriving rather
 * than a blank screen that looks like a failure.
 */
export default function Loading() {
  return (
    <main className="app-shell">
      <div className="hero-gradient relative h-52 overflow-hidden rounded-b-[2.2rem] px-5 pt-12">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-white/20" />
        <div className="mt-3 h-4 w-56 animate-pulse rounded-lg bg-white/15" />
      </div>
      <div className="relative -mt-12 space-y-5 px-4 pb-6">
        <CardSkeleton className="h-28" />
        {/* The four department cards, at the height they really are. */}
        <TileSkeleton count={4} className="h-44" />
        <CardSkeleton className="h-40" />
      </div>
    </main>
  );
}
