import { useTranslation } from "react-i18next";
import { TEXT_SCALES, TextScale, writeTextScale } from "../../design/textScale";

interface TextSizeControlProps {
  value: TextScale;
  onChange: (value: TextScale) => void;
}

/**
 * A / A+ / A++ as a radio group, not three buttons: a screen reader announces
 * "text size, A++, selected" and arrow keys move between options, which is what
 * the pattern should do. Each stop shows its own sample size so the choice is
 * legible without previewing it on the page.
 */
export function TextSizeControl({ value, onChange }: TextSizeControlProps) {
  const { t } = useTranslation();

  const select = (scale: TextScale) => {
    writeTextScale(scale);
    onChange(scale);
  };

  return (
    <div role="radiogroup" aria-label={t("settings.textSize")} className="grid grid-cols-3 gap-2">
      {TEXT_SCALES.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => select(option.value)}
            className={`min-h-[var(--tap-min)] rounded-[var(--radius-md)] border px-3 font-semibold transition-colors duration-[var(--motion-fast)] ${
              selected
                ? "bg-brand-600 text-white border-brand-600"
                : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700"
            }`}
            style={{ fontSize: `${option.scale}rem` }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
