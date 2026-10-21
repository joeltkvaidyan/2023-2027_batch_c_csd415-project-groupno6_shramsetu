import { forwardRef, type HTMLAttributes } from "react";

export interface EmployerCardProps extends HTMLAttributes<HTMLDivElement> {
  name: string;
  occupation?: string | null;
  place?: string | null;
  experience?: number | null;
  rating?: { average: number | null; count: number };
  stats?: {
    days_worked: number;
    total_agreed: number;
    total_paid: number;
    total_outstanding: number;
  };
  onRate?: () => void;
  onHire?: () => void;
  ratingOpen?: boolean;
  children?: React.ReactNode;
}

export const EmployerCard = forwardRef<HTMLDivElement, EmployerCardProps>(function EmployerCard(
  {
    name,
    occupation,
    place,
    experience,
    rating,
    stats,
    onRate,
    onHire,
    ratingOpen,
    className = "",
    children,
    ...rest
  },
  ref
) {
  const avg = rating?.average ?? null;
  const count = rating?.count ?? 0;

  return (
    <div
      ref={ref}
      className={`rounded-2xl p-5 border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-card transition-all duration-200 hover:shadow-card-hover hover:-translate-y-1 ${className}`}
      {...rest}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{name}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {occupation?.replace(/_/g, " ") || "Trade not recorded"}
            {experience != null ? ` • ${experience} yrs exp.` : ""}
            {place ? ` • ${place}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ratingOpen ? (
            <span className="px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-xs font-medium">
              Rating…
            </span>
          ) : (
            <div className="flex items-center gap-1 text-xs">
              <span className="text-amber-500" aria-hidden="true">★</span>
              <span className={avg != null ? "text-gray-700 dark:text-gray-300" : "text-gray-400"}>
                {avg?.toFixed(1) ?? "—"}
              </span>
              <span className="text-gray-400">({count})</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-700/40">
          <p className="text-xs text-gray-400 uppercase font-semibold">Days worked</p>
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
            {stats?.days_worked ?? "—"}
          </p>
        </div>
        <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-700/40">
          <p className="text-xs text-gray-400 uppercase font-semibold">Unpaid wages</p>
          <p className="text-sm font-bold text-red-600 dark:text-red-400">
            ₹{stats?.total_outstanding ?? "—"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-gray-100 dark:border-gray-700">
        {onRate && (
          <button
            onClick={onRate}
            className="flex-1 text-sm font-medium bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-400 border border-brand-100 dark:border-brand-800/50 rounded-xl py-2 hover:bg-brand-100 dark:hover:bg-brand-900/30 transition"
          >
            Rate worker
          </button>
        )}
        {children}
      </div>
    </div>
  );
});
