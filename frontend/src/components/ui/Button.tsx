import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  loadingText?: string;
  icon?: React.ReactNode;
}

const sizes = {
  sm: "px-3.5 py-2 text-sm rounded-lg gap-1.5",
  md: "px-5 py-3 text-base rounded-xl gap-2",
  lg: "px-6 py-4 text-lg rounded-2xl gap-2",
};

const variants = {
  primary:
    "bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-md shadow-brand-600/25 hover:from-brand-500 hover:to-brand-700 hover:shadow-lg hover:shadow-brand-600/30 active:scale-[0.98] focus-visible:ring-brand-500",
  secondary:
    "border-2 border-brand-600/90 bg-white/60 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/40 hover:border-brand-600 active:scale-[0.98] focus-visible:ring-brand-500",
  ghost:
    "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.98] focus-visible:ring-gray-400",
  danger:
    "bg-red-600 text-white hover:bg-red-700 shadow-sm shadow-red-600/25 active:scale-[0.98] focus-visible:ring-red-500",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    loadingText,
    icon,
    className = "",
    children,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-semibold transition-all duration-150
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900
        disabled:opacity-50 disabled:pointer-events-none ${sizes[size]} ${variants[variant]} ${className}`}
      {...rest}
    >
      {loading ? (
        <>
          <svg
            className="animate-spin -ml-1 h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
          {loadingText ?? "…"}
        </>
      ) : (
        <>
          {icon && <span className="shrink-0 [&>svg]:h-5 [&>svg]:w-5">{icon}</span>}
          {children}
        </>
      )}
    </button>
  );
});
