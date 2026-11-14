import { forwardRef, type HTMLAttributes } from "react";

export interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string | number;
  trend?: string;
  trendPositive?: boolean;
  icon?: React.ReactNode;
}

export const StatCard = forwardRef<HTMLDivElement, StatCardProps>(function StatCard(
  { label, value, trend, trendPositive = true, icon, className = "", children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`rounded-2xl p-5 border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-card ${className}`}
      {...rest}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">{label}</p>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</span>
            {children && (
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                {children}
              </span>
            )}
          </div>
          {trend && (
            <p
              className={`text-xs font-semibold mt-1.5 ${
                trendPositive
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              } flex items-center gap-1`}
            >
              {trendPositive ? "▲" : "▼"} {trend}
            </p>
          )}
        </div>
        {icon && (
          <div className="p-2.5 rounded-xl bg-gray-50 dark:bg-gray-700/40 text-gray-400">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
});

export interface StatGridProps {
  children: React.ReactNode;
}

export function StatGrid({ children }: StatGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {children}
    </div>
  );
}
