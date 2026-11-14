import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { Mic } from "lucide-react";

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  /** Helper text shown under the label, before the input. */
  hint?: string;
  /** Translated, human-readable error. Replaces the hint's slot. */
  error?: string | null;
  /** Shows a microphone button beside the input (voice input). */
  onMic?: () => void;
  micLabel?: string;
  micActive?: boolean;
  as?: "input" | "textarea";
  rows?: number;
  trailing?: ReactNode;
}

/**
 * A labelled form control with its error wired to the input through
 * `aria-describedby` and `aria-invalid`.
 *
 * That wiring is the whole point of having a component: a red border alone tells
 * a sighted user something is wrong and tells a screen-reader user nothing. The
 * error is a live region so it is announced when it appears, not only when the
 * field is refocused.
 *
 * The mic button is optional and never mandatory — voice input is an accelerator
 * for people who find typing a Tamil subject on a phone keyboard slow, not the
 * only way to fill the form.
 */
export function Field({
  label,
  hint,
  error,
  onMic,
  micLabel,
  micActive = false,
  as = "input",
  rows = 4,
  trailing,
  className = "",
  ...rest
}: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  const shared = {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    className:
      `input-field ${error ? "input-error" : ""} ${onMic ? "pr-14" : ""} ${className}`.trim(),
    ...rest,
  };

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-sm font-medium text-ink-secondary dark:text-gray-300"
      >
        {label}
      </label>
      {hint && !error && (
        <p id={hintId} className="mb-1 text-sm text-ink-muted">
          {hint}
        </p>
      )}

      <div className="relative">
        {as === "textarea" ? (
          <textarea
            {...(shared as unknown as InputHTMLAttributes<HTMLTextAreaElement>)}
            rows={rows}
          />
        ) : (
          <input {...shared} />
        )}

        {onMic && (
          <button
            type="button"
            onClick={onMic}
            aria-label={micLabel ?? label}
            aria-pressed={micActive}
            className={`absolute right-1.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full
              transition-colors duration-[var(--motion-fast)]
              ${
                micActive
                  ? "bg-red-600 text-white"
                  : "text-ink-secondary hover:bg-black/5 dark:hover:bg-white/10"
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`}
          >
            <Mic className="h-5 w-5" aria-hidden="true" />
          </button>
        )}

        {trailing}
      </div>

      {error && (
        <p id={errorId} role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
