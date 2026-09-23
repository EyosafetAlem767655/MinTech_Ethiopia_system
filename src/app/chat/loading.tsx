import { CardSkeleton } from "@/components/Skeleton";

/** The chat, while it loads. A conversation is a column of bubbles. */
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col px-4 py-6 lg:max-w-3xl">
      <div className="h-6 w-32 animate-pulse rounded-full bg-clay-50" />
      <div className="mt-6 space-y-3">
        <CardSkeleton className="h-16" />
        <CardSkeleton className="ml-auto h-12 w-3/4" />
        <CardSkeleton className="h-24" />
      </div>
    </main>
  );
}
