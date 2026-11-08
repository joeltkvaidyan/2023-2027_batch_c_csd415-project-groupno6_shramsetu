import { AlertTriangle, RefreshCw } from "lucide-react";

interface ErrorStateProps {
  /** Translated, specific reason if there is one. */
  message: string;
  onRetry?: () => void;
  retryLabel: string;
}

/**
 * A failure with a way out.
 *
 * The pattern it replaces was a bare red paragraph — true, unhelpful, and a dead
 * end on a screen whose only content was the thing that failed. The reason is
 * stated in the worker's language and the action that fixes it (usually: try
 * again) is the largest thing on the surface.
 */
export function ErrorState({ message, onRetry, retryLabel }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 dark:bg-red-900/30">
        <AlertTriangle
          className="h-7 w-7 text-red-700 dark:text-red-300"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </div>
      <p role="alert" className="max-w-xs text-base text-ink-secondary">
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex min-h-tap items-center gap-2 rounded-[var(--radius-md)] border-2 border-brand-600 px-5 font-semibold text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {retryLabel}
        </button>
      )}
    </div>
  );
}
