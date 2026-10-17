import { Skeleton } from "@/components/ui";

// Reserves roughly the space of a heading, a next-step banner and two content blocks so the page does not jump.
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="max-w-3xl">
      <Skeleton className="mb-2 h-4 w-24" />
      <Skeleton className="mb-6 h-8 w-1/3" />
      <Skeleton className="mb-4 h-20 w-full rounded-lg" />
      <Skeleton className="mb-4 h-24 w-full rounded-lg" />
      <Skeleton className="h-24 w-full rounded-lg" />
    </div>
  );
}
