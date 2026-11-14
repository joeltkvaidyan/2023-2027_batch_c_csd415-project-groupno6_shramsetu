import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type StatusTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const tones: Record<StatusTone, string> = {
  neutral: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100",
  brand: "bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200",
  success: "bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-200",
  warning: "bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100",
  danger: "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-200",
  info: "bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
};

/**
 * A status is an icon *and* a word, never a colour.
 *
 * The grievance list used to lean on colour to distinguish "under review" from
 * "resolved" — unreadable for the roughly one in twelve men who is colour-blind,
 * and unreadable for anyone in direct sunlight. Every chip therefore carries its
 * own icon and its own label; the tint is a hint, not the message.
 */
export function StatusChip({
  tone = "neutral",
  icon: Icon,
  children,
  className = "",
}: {
  tone?: StatusTone;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold ring-1 ring-inset ring-black/5 dark:ring-white/10 ${tones[tone]} ${className}`}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />}
      {children}
    </span>
  );
}
