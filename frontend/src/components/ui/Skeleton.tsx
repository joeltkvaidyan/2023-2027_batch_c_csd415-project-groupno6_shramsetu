/** Skeleton loading primitives — shimmer placeholders that match the shape
 * of the content they replace, so pages don't jump when data arrives. */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`rounded-xl skeleton animate-shimmer ${className}`} aria-hidden="true" />;
}

export function SkeletonList({
  rows = 3,
  rowClass = "h-16",
}: {
  rows?: number;
  rowClass?: string;
}) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={rowClass} />
      ))}
    </div>
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}
