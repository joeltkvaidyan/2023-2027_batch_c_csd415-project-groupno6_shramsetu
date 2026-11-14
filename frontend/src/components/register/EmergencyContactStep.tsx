/**
 * Step 5: Emergency contact + required privacy consent.
 * Extracted verbatim from WorkerRegisterPage (behaviour unchanged); inputs
 * given explicit id/htmlFor label associations for screen readers.
 */
import { useTranslation } from "react-i18next";
import FieldErrorText from "./FieldErrorText";
import { fieldClass, type RegisterStepProps } from "./constants";

export default function EmergencyContactStep({
  formData,
  fieldErrors,
  onChange,
}: RegisterStepProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-gray-900 dark:text-white">{t("auth.stepEmergency")}</h3>

      <div>
        <label
          htmlFor="register-emergencyContactName"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t("auth.emergencyContactName")} *
        </label>
        <input
          id="register-emergencyContactName"
          className={fieldClass(fieldErrors, "emergencyContactName")}
          aria-invalid={!!fieldErrors.emergencyContactName}
          aria-describedby={
            fieldErrors.emergencyContactName ? "emergencyContactName-error" : undefined
          }
          value={formData.emergencyContactName}
          onChange={(e) => onChange("emergencyContactName", e.target.value)}
          placeholder="Full name"
        />
        <FieldErrorText
          id="emergencyContactName-error"
          message={fieldErrors.emergencyContactName}
        />
      </div>

      <div>
        <label
          htmlFor="register-emergencyContactRelation"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t("auth.emergencyContactRelation")}
        </label>
        <input
          id="register-emergencyContactRelation"
          className="input-field"
          value={formData.emergencyContactRelation}
          onChange={(e) => onChange("emergencyContactRelation", e.target.value)}
          placeholder="e.g., Mother, Brother, Spouse"
        />
      </div>

      <div>
        <label
          htmlFor="register-emergencyContactNumber"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t("auth.emergencyContactNumber")} *
        </label>
        <input
          id="register-emergencyContactNumber"
          type="tel"
          inputMode="numeric"
          className={fieldClass(fieldErrors, "emergencyContactNumber")}
          aria-invalid={!!fieldErrors.emergencyContactNumber}
          aria-describedby={
            fieldErrors.emergencyContactNumber ? "emergencyContactNumber-error" : undefined
          }
          value={formData.emergencyContactNumber}
          onChange={(e) => onChange("emergencyContactNumber", e.target.value)}
          placeholder="10-digit mobile number"
        />
        <FieldErrorText
          id="emergencyContactNumber-error"
          message={fieldErrors.emergencyContactNumber}
        />
      </div>

      <p className="text-xs text-gray-700 dark:text-gray-300 bg-blue-50 dark:bg-blue-900/40 p-3 rounded border border-blue-100 dark:border-blue-800">
        {t("auth.consentNotice")}
      </p>

      {/* Required privacy consent: chat/voice go to third-party AI providers */}
      <label htmlFor="consent-ai" className="flex items-start gap-3 min-h-[44px] cursor-pointer">
        <input
          id="consent-ai"
          name="consent_ai_processing"
          type="checkbox"
          checked={formData.consentAiProcessing}
          onChange={(e) => onChange("consentAiProcessing", e.target.checked)}
          aria-invalid={!!fieldErrors.consentAiProcessing}
          aria-describedby={fieldErrors.consentAiProcessing ? "consent-ai-error" : undefined}
          className="mt-1 h-5 w-5 shrink-0 rounded border-gray-400 text-brand-600 focus:ring-brand-500"
        />
        <span className="text-sm text-gray-700 dark:text-gray-300">
          {t("auth.consentCheckbox")}
        </span>
      </label>
      <FieldErrorText id="consent-ai-error" message={fieldErrors.consentAiProcessing} />
    </div>
  );
}
