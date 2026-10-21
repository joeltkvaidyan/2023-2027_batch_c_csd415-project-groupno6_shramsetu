import { forwardRef, type HTMLAttributes } from "react";

export interface JobCardProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  employer: string;
  occupation?: string | null;
  location?: string | null;
  wage?: { min: number | null; max: number | null; period: string };
  openings?: number;
  workType?: string;
  onApply?: () => void;
  onDetails?: () => void;
  applied?: boolean;
  className?: string;
}

export const JobCard = forwardRef<HTMLDivElement, JobCardProps>(function JobCard(
  { title, employer, occupation, location, wage, openings, workType, onApply, onDetails, applied, className = "", ...rest },
  ref
) {
  const wageText = wage?.min != null && wage?.max != null ? `₹${wage.min}–₹${wage.max} / ${wage.period}` : "Wage not listed";
  return (
    <div
      ref={ref}
      className={`rounded-2xl p-5 border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-card transition-all duration-200 hover:shadow-card-hover hover:-translate-y-1 ${className}`}
      {...rest}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {occupation ? occupation.replace(/_/g, " ") : "Trade not specified"} • {location || "Location not specified"}
          </p>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <span className="px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border border-green-100 dark:border-green-800/50 font-medium">
            Open
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4 text-sm text-gray-600 dark:text-gray-300">
        <span className="flex items-center gap-1"><span className="text-gray-400" aria-hidden="true">💼</span> {employer}</span>
        {wage && <span className="flex items-center gap-1 text-brand-600 dark:text-brand-400 font-medium">{wageText}</span>}
        {openings != null && <span className="flex items-center gap-1">{openings} opening{openings > 1 ? "s" : ""}</span>}
      </div>

      <div className="flex items-center justify-between gap-2 pt-3 border-t border-gray-100 dark:border-gray-700">
        {applied ? (
          <button disabled className="flex-1 text-sm font-medium bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-xl py-2.5 cursor-not-allowed">
            Applied
          </button>
        ) : (
          <>
            {onDetails && (
              <button
                onClick={onDetails}
                className="flex-1 text-sm font-medium border border-gray-200 dark:border-gray-600 rounded-xl py-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
              >
                Details
              </button>
            )}
            {onApply && (
              <button onClick={onApply} className="flex-1 bg-gradient-to-b from-brand-500 to-brand-600 text-white text-sm font-medium rounded-xl py-2.5 shadow-md shadow-brand-600/25 hover:shadow-lg hover:shadow-brand-600/30 active:scale-[0.98] transition">
                Apply
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
});
