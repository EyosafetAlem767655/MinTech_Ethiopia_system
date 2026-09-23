import { PageSkeleton } from "@/components/Skeleton";

/**
 * A department page, while its panels are on their way.
 *
 * Every department is a stack of report cards, so one shape serves all four.
 */
export default function Loading() {
  return (
    <main className="app-shell px-4 pb-6 pt-4">
      <div className="h-4 w-16 animate-pulse rounded-full bg-clay-50" />
      <PageSkeleton cards={3} />
    </main>
  );
}
