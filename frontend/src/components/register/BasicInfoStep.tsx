/**
 * Step 1: Basic info (photo, name, mobile, email, password).
 * Extracted verbatim from WorkerRegisterPage (behaviour unchanged); inputs
 * given explicit id/htmlFor label associations for screen readers.
 */
import { useTranslation } from "react-i18next";
import { Camera } from "lucide-react";
import FieldErrorText from "./FieldErrorText";
import { fieldClass, type RegisterStepProps } from "./constants";

interface BasicInfoStepProps extends RegisterStepProps {
  onPhotoChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function BasicInfoStep({
  formData,
  fieldErrors,
  onChange,
  onPhotoChange,
}: BasicInfoStepProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-gray-900 dark:text-white">{t("auth.stepBasicInfo")}</h3>

      <div className="flex flex-col items-center mb-4">
        <label
          htmlFor="photo-upload"
          className="w-24 h-24 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center overflow-hidden border-2 border-dashed border-gray-300 dark:border-gray-600 cursor-pointer transition hover:border-brand-500 hover:bg-brand-50/50 dark:hover:bg-brand-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {formData.photoPreview ? (
            <img src={formData.photoPreview} alt="Profile" className="w-full h-full object-cover" />
          ) : (
            <Camera className="h-8 w-8 text-gray-400" strokeWidth={1.5} aria-hidden="true" />
          )}
        </label>
        <input
          id="photo-upload"
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onPhotoChange}
        />
        <span className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          {t("auth.uploadPhoto")}
        </span>
      </div>

      <div>
        <label
          htmlFor="register-fullName"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t("auth.fullName")} *
        </label>
        <input
          id="register-fullName"
          className={fieldClass(fieldErrors, "fullName")}
          aria-invalid={!!fieldErrors.fullName}
          aria-describedby={fieldErrors.fullName ? "fullName-error" : undefined}
          value={formData.fullName}
          onChange={(e) => onChange("fullName", e.target.value)}
          placeholder="e.g., Raj Kumar"
        />
        <FieldErrorText id="fullName-error" message={fieldErrors.fullName} />
      </div>

      <div>
        <label
          htmlFor="register-mobileNumber"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t("auth.mobileNumber")} *
        </label>
        <input
          id="register-mobileNumber"
          type="tel"
          inputMode="numeric"
          className={fieldClass(fieldErrors, "mobileNumber")}
          aria-invalid={!!fieldErrors.mobileNumber}
          aria-describedby={fieldErrors.mobileNumber ? "mobileNumber-error" : undefined}
          value={formData.mobileNumber}
          onChange={(e) => onChange("mobileNumber", e.target.value)}
          placeholder="9876543210"
        />
        <FieldErrorText id="mobileNumber-error" message={fieldErrors.mobileNumber} />
      </div>

      <div>
        <label
          htmlFor="register-email"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t("auth.email")} <span className="text-gray-400">({t("auth.optional")})</span>
        </label>
        <input
          id="register-email"
          type="email"
          className="input-field"
          value={formData.email}
          onChange={(e) => onChange("email", e.target.value)}
          placeholder="your@email.com"
        />
      </div>

      <div>
        <label
          htmlFor="register-password"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t("auth.password")} *
        </label>
        <input
          id="register-password"
          type="password"
          minLength={6}
          className={fieldClass(fieldErrors, "password")}
          aria-invalid={!!fieldErrors.password}
          aria-describedby={fieldErrors.password ? "password-error" : undefined}
          value={formData.password}
          onChange={(e) => onChange("password", e.target.value)}
        />
        <FieldErrorText id="password-error" message={fieldErrors.password} />
      </div>
    </div>
  );
}
