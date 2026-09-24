/**
 * The waiting state, in the shape of the thing being waited for.
 *
 * Every panel already renders `card animate-pulse bg-clay-50` while its fetch is
 * in flight; these wrap that one idiom so the route-level `loading.tsx` files
 * and the panels shimmer identically. A second, different-looking spinner would
 * read as a different kind of wait.
 *
 * Deliberately server components — no "use client". These render on a
 * navigation before any JavaScript for the destination has arrived, which is
 * exactly the moment they are for.
 */

export function CardSkeleton({ className = "h-40" }: { className?: string }) {
  return <div className={`card animate-pulse bg-clay-50 ${className}`} />;
}

/** A row of tiles, as the KPI grids use. */
export function TileSkeleton({ count = 4, className = "h-24" }: { count?: number; className?: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} className={className} />
      ))}
    </div>
  );
}

/** The pill strip a range selector or tab bar occupies. */
export function PillsSkeleton() {
  return <div className="h-9 animate-pulse rounded-full bg-clay-50" />;
}

/**
 * A page's worth of waiting: a heading line, then cards.
 *
 * The heights are not arbitrary — they match the real panels closely enough
 * that the content fills in rather than shoving the page around when it lands.
 */
export function PageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="space-y-4 py-4">
      <div className="h-5 w-40 animate-pulse rounded-full bg-clay-50" />
      <PillsSkeleton />
      {Array.from({ length: cards }).map((_, i) => (
        <CardSkeleton key={i} className={i === 0 ? "h-56" : "h-40"} />
      ))}
    </div>
  );
}
