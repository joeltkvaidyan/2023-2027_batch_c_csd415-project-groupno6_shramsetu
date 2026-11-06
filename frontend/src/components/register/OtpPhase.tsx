/**
 * OTP verification phase of worker registration.
 * Extracted verbatim from WorkerRegisterPage (behaviour unchanged);
 * OTP input given an explicit id/htmlFor label association.
 */
import { AlertCircle, Loader2, ShieldCheck } from "lucide-react";
import type { RegistrationResponse } from "./constants";

interface OtpPhaseProps {
  registrationData: RegistrationResponse | null;
  otp: string;
  setOtp: (value: string) => void;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
}

export default function OtpPhase({
  registrationData,
  otp,
  setOtp,
  submitting,
  error,
  onSubmit,
}: OtpPhaseProps) {
  return (
    <div className="space-y-6 mt-6">
      <div className="text-center">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 dark:from-brand-900/40 dark:to-brand-900/20 ring-1 ring-inset ring-brand-200/70 dark:ring-brand-800 flex items-center justify-center mb-4 animate-pop-in">
          <ShieldCheck className="h-8 w-8 text-brand-500" strokeWidth={1.5} aria-hidden="true" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Verify Your Phone
        </h3>
        <p className="text-gray-600 dark:text-gray-400">
          Enter the 6-digit code sent to {registrationData?.mobile_number}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="space-y-4"
      >
        <div>
          <label
            htmlFor="register-otp"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            OTP Code
          </label>
          <input
            id="register-otp"
            type="text"
            inputMode="numeric"
            maxLength={6}
            className="input-field text-center text-2xl tracking-widest"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            disabled={submitting}
          />
        </div>

        {error && (
          <p className="text-red-600 dark:text-red-400 text-sm p-3 bg-red-50 dark:bg-red-900/20 border border-red-200/70 dark:border-red-800 rounded-xl flex items-start gap-2 animate-scale-in">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || otp.length !== 6}
          className="btn-primary mt-6"
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Verifying...
            </span>
          ) : (
            "Verify & Continue"
          )}
        </button>
      </form>
    </div>
  );
}
