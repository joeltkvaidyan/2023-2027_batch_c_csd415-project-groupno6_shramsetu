import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Check, CircleDashed, TriangleAlert } from "lucide-react";
import type { WageEntry } from "../types";
import { StatusChip } from "./ui/StatusChip";

export interface CalendarCell {
  /** Plain calendar day, "YYYY-MM-DD", matching what the API stores. */
  iso: string;
  dayNumber: number;
  entry?: WageEntry;
}

/**
 * Turn a month and its entries into a grid a worker can read at a glance.
 *
 * Pure and exported because the interesting part is the arithmetic — which
 * weekday the 1st fell on, and whether a day has an entry — and that is worth
 * testing without a DOM. Dates are built from the `YYYY-MM` string rather than
 * `new Date(iso)`: the API returns UTC midnight, and rendering that in a browser
 * behind UTC would shift every cell one day earlier.
 */
export function buildMonthGrid(month: string, entries: WageEntry[]): (CalendarCell | null)[] {
  const [year, monthIndex] = month.split("-").map((part) => Number(part));
  if (!year || !monthIndex) return [];

  const byDay = new Map(entries.map((entry) => [String(entry.work_date).slice(0, 10), entry]));
  const daysInMonth = new Date(year, monthIndex, 0).getDate();
  // 0 = Sunday, which is how the columns below are ordered.
  const leading = new Date(year, monthIndex - 1, 1).getDay();

  const cells: (CalendarCell | null)[] = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${year}-${String(monthIndex).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ iso, dayNumber: day, entry: byDay.get(iso) });
  }
  return cells;
}

/**
 * "2026-11" -> "November 2026" in the reader's language.
 *
 * The page used to interpolate the raw ISO string into the heading, so a worker
 * read "Wage calendar for 2026-11". Built from parts for the same reason the grid
 * is: no UTC round-trip, so no off-by-one month at a timezone boundary.
 */
export function formatMonthLabel(month: string, locale: string): string {
  const [year, monthIndex] = month.split("-").map((part) => Number(part));
  if (!year || !monthIndex) return month;
  return new Intl.DateTimeFormat(locale || "en", { month: "long", year: "numeric" }).format(
    new Date(year, monthIndex - 1, 1),
  );
}

const STATUS_ICON = {
  paid: Check,
  partial: TriangleAlert,
  unpaid: CircleDashed,
} as const;

const STATUS_CELL = {
  paid: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100 border-green-300 dark:border-green-800",
  partial:
    "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 border-amber-300 dark:border-amber-800",
  unpaid:
    "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100 border-red-300 dark:border-red-800",
} as const;

interface WageCalendarProps {
  month: string;
  entries: WageEntry[];
  onSelectDay: (iso: string) => void;
  /** The day currently held in the form, highlighted so the two agree. */
  selectedDay?: string;
}

/**
 * A month at a glance: one square per day, an icon for what happened, a legend
 * that says what the icons mean. Icons rather than three shades of red, because
 * "partial" and "unpaid" are the two states a worker most needs to tell apart
 * and the two most likely to look identical in sunlight or with colour blindness.
 */
export function WageCalendar({ month, entries, onSelectDay, selectedDay }: WageCalendarProps) {
  const { t, i18n } = useTranslation();
  const cells = useMemo(() => buildMonthGrid(month, entries), [month, entries]);

  // Day names from the platform in the app's language: no extra translation
  // keys, and the worker's own locale decides whether the week starts on Sunday.
  const weekdays = useMemo(() => {
    const format = new Intl.DateTimeFormat(i18n.language || "en", { weekday: "short" });
    // 2024-01-07 was a Sunday.
    return Array.from({ length: 7 }, (_, i) => format.format(new Date(2024, 0, 7 + i)));
  }, [i18n.language]);

  const rupees = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
  const monthLabel = formatMonthLabel(month, i18n.language || "en");

  return (
    <section aria-label={t("wages.calendarLabel", { month: monthLabel })}>
      <div className="grid grid-cols-7 gap-1.5 text-center" role="grid">
        {weekdays.map((name) => (
          <div
            key={name}
            role="columnheader"
            className="pb-1 text-xs font-medium text-ink-muted"
            aria-hidden="true"
          >
            {name}
          </div>
        ))}

        {cells.map((cell, index) => {
          if (!cell) return <div key={`blank-${index}`} aria-hidden="true" />;
          const status = cell.entry?.payment_status;
          const Icon = status ? STATUS_ICON[status] : null;
          const isSelected = cell.iso === selectedDay;
          const label = cell.entry
            ? t("wages.cellLabel", {
                date: cell.iso,
                status: t(`wages.status.${cell.entry.payment_status}`),
                agreed: rupees(cell.entry.agreed_amount),
                paid: rupees(cell.entry.paid_amount),
              })
            : t("wages.cellEmpty", { date: cell.iso });

          return (
            <button
              key={cell.iso}
              type="button"
              onClick={() => onSelectDay(cell.iso)}
              aria-label={label}
              aria-pressed={isSelected}
              className={`flex aspect-square flex-col items-center justify-center gap-0.5 rounded-[var(--radius-sm)] border text-sm font-semibold tabular-nums
                transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
                ${
                  status
                    ? STATUS_CELL[status]
                    : "border-line/60 bg-surface-sunken text-ink-muted hover:border-brand-400"
                }
                ${isSelected ? "ring-2 ring-brand-600 ring-offset-1" : ""}`}
            >
              <span aria-hidden="true">{cell.dayNumber}</span>
              {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {(["paid", "partial", "unpaid"] as const).map((status) => (
          <StatusChip
            key={status}
            tone={status === "paid" ? "success" : status === "partial" ? "warning" : "danger"}
            icon={STATUS_ICON[status]}
          >
            {t(`wages.status.${status}`)}
          </StatusChip>
        ))}
      </div>
    </section>
  );
}
