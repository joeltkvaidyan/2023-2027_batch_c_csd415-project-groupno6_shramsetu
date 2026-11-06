import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export function Screen({
  children,
  title,
  onBack,
  hideBack,
}: {
  children: ReactNode;
  title?: string;
  onBack?: (() => void) | true;
  hideBack?: boolean;
}) {
  const navigate = useNavigate();
  const handleBack = hideBack
    ? undefined
    : onBack === true
      ? () => navigate(-1)
      : (onBack ?? (() => navigate(-1)));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      {(title || handleBack) && (
        <header className="glass sticky top-0 z-20 flex items-center gap-3 px-4 py-3 border-b border-gray-200/70 dark:border-gray-700/60">
          {handleBack && (
            <button
              onClick={handleBack}
              aria-label="Back"
              className="w-9 h-9 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 shadow-sm shrink-0 transition-all duration-150 hover:text-gray-900 dark:hover:text-white hover:border-gray-300 dark:hover:border-gray-600 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={2.25} aria-hidden="true" />
            </button>
          )}
          {title && (
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">{title}</h1>
          )}
        </header>
      )}
      {/* pb-24 reserves room for the floating bottom dock on pages that don't
          manage their own bottom padding */}
      <main className="flex-1 px-4 pt-5 max-w-md mx-auto w-full pb-28">{children}</main>
    </div>
  );
}
