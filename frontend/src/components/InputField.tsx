import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

export interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  error?: string | null;
  hint?: string;
}

/** Labeled text input wrapping the global .input-field style. */
export const InputField = forwardRef<HTMLInputElement, InputFieldProps>(function InputField(
  { label, error, hint, className = "", id, ...rest },
  ref,
) {
  const inputId =
    id ?? (label ? `field-${String(label).replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <div>
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={`input-field ${error ? "!border-red-400 focus:!ring-red-400" : ""} ${className}`}
        aria-invalid={Boolean(error)}
        {...rest}
      />
      {hint && !error && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
});
