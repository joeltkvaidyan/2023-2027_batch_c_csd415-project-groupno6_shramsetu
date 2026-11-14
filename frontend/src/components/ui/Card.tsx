import { forwardRef, type HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Subtle hover lift + shadow. Use for interactive cards only. */
  interactive?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive = false, className = "", children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700/60 shadow-card
        ${interactive ? "transition-all duration-200 hover:shadow-card-hover hover:-translate-y-0.5 hover:border-brand-200 dark:hover:border-brand-800 cursor-pointer" : ""}
        ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
});
