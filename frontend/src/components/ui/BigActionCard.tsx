import type { LucideIcon } from "lucide-react";

interface BigActionCardProps {
  icon: LucideIcon;
  label: string;
  description?: string;
  onClick: () => void;
  /** Optional read-aloud action. Rendered as a sibling button, never nested. */
  onSpeak?: () => void;
  speakLabel?: string;
  tone?: "brand" | "amber" | "blue";
  disabled?: boolean;
}

const tones = {
  brand: "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
};

/**
 * The three things a worker actually opens the app to do.
 *
 * Not a tile with an icon and a caption: a full-width target with a 24px icon, a
 * label set at body size, and an optional speaker that reads the label out. The
 * speaker is a sibling button rather than a nested one — a button inside a button
 * is invalid HTML, and screen readers announce the outer one as "button" with no
 * way to reach the inner.
 */
export function BigActionCard({
  icon: Icon,
  label,
  description,
  onClick,
  onSpeak,
  speakLabel,
  tone = "brand",
  disabled = false,
}: BigActionCardProps) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="flex w-full min-h-tap items-center gap-4 rounded-[var(--radius-lg)] border border-line bg-surface-raised p-4 text-left
          transition-colors duration-[var(--motion-fast)] hover:border-brand-400 focus-visible:outline-none
          focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2
          disabled:opacity-55 disabled:pointer-events-none"
      >
        <span
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-md)] ${tones[tone]}`}
          aria-hidden="true"
        >
          <Icon className="h-6 w-6" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-ink">{label}</span>
          {description && (
            <span className="mt-0.5 block text-sm text-ink-secondary">{description}</span>
          )}
        </span>
      </button>

      {onSpeak && (
        <button
          type="button"
          onClick={onSpeak}
          aria-label={speakLabel ?? label}
          className="absolute right-2 bottom-2 flex h-11 w-11 items-center justify-center rounded-full
            text-ink-secondary hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline-none
            focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <SpeakerIcon />
        </button>
      )}
    </div>
  );
}

function SpeakerIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}
