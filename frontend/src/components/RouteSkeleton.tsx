/**
 * What a guarded route shows while it is deciding.
 *
 * The old guards rendered `null`, so the screen was blank while the session was
 * checked and looked like a broken page — or worse, like a slow redirect. A
 * skeleton says \"this page is coming\" without exposing a single piece of the
 * page's content to a visitor who may turn out to be signed out.
 *
 * Deliberately text-free: no locale keys, nothing to translate, and nothing for
 * a crawler or a shoulder-surfer to read.
 */
export function RouteSkeleton() {
  return (
    <div
      className="min-h-screen bg-gray-50 dark:bg-gray-900 px-4 py-6"
      role="status"
      aria-busy="true"
      aria-live="polite"
      data-testid="route-skeleton"
    >
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="h-8 w-1/3 rounded-md bg-gray-200 dark:bg-gray-800 animate-pulse" />
        <div className="h-28 rounded-xl bg-gray-200 dark:bg-gray-800 animate-pulse" />
        <div className="grid grid-cols-2 gap-4">
          <div className="h-24 rounded-xl bg-gray-200 dark:bg-gray-800 animate-pulse" />
          <div className="h-24 rounded-xl bg-gray-200 dark:bg-gray-800 animate-pulse" />
        </div>
        <div className="h-40 rounded-xl bg-gray-200 dark:bg-gray-800 animate-pulse" />
      </div>
    </div>
  );
}
