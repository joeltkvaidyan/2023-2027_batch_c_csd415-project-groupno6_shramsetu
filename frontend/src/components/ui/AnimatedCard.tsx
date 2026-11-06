import { useState } from "react";

interface AnimatedCardProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  direction?: "up" | "down" | "left" | "right";
  onClick?: () => void;
}

export function AnimatedCard({ children, className = "", onClick }: AnimatedCardProps) {
  const [hovered, setHovered] = useState(false);

  // Only a clickable card becomes a button role: Enter/Space must do what a
  // tap does, otherwise the card is a dead end for keyboard users.
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={`card ${onClick ? "cursor-pointer" : ""} transition-all duration-300 ${
        hovered ? "scale-[1.02] -translate-y-0.5 shadow-lg" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

interface AnimatedButtonProps {
  children: React.ReactNode;
  className?: string;
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function AnimatedButton({
  children,
  className = "",
  variant = "primary",
  size = "md",
  onClick,
  disabled = false,
  loading = false,
}: AnimatedButtonProps) {
  const baseClasses =
    "relative overflow-hidden rounded-2xl font-semibold transition-all duration-300 active:scale-[0.98]";

  const variantClasses = {
    primary:
      "bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-lg shadow-brand-600/25 hover:shadow-xl hover:shadow-brand-600/30",
    secondary:
      "border-2 border-brand-600 bg-white dark:bg-transparent text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/40",
    danger:
      "bg-gradient-to-b from-red-500 to-red-600 text-white shadow-lg shadow-red-600/25 hover:shadow-xl",
  };

  const sizeClasses = {
    sm: "px-4 py-2 text-sm",
    md: "px-6 py-3 text-base",
    lg: "px-8 py-4 text-lg",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2">
          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <span>Loading...</span>
        </div>
      ) : (
        children
      )}
    </button>
  );
}
