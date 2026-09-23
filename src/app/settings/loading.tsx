import { CardSkeleton, PillsSkeleton } from "@/components/Skeleton";

/** Settings, while it loads: the hero band, the tab strip, then the list. */
export default function Loading() {
  return (
    <main className="app-shell px-4 pb-10">
      <div className="hero-gradient -mx-4 h-40 px-5 pt-10 sm:mx-0 sm:mt-4 sm:rounded-2xl">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-white/20" />
      </div>
      <div className="space-y-4 py-5">
        <PillsSkeleton />
        <CardSkeleton className="h-24" />
        <CardSkeleton className="h-24" />
        <CardSkeleton className="h-24" />
      </div>
    </main>
  );
}
