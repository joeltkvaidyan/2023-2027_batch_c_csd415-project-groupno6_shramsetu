/**
 * Step 2: Personal details (date of birth, gender, Aadhaar).
 * Extracted verbatim from WorkerRegisterPage (behaviour unchanged); inputs
 * given explicit id/htmlFor label associations for screen readers.
 */
import { useTranslation } from "react-i18next";
import FieldErrorText from "./FieldErrorText";
import { fieldClass, type RegisterStepProps } from "./constants";

export default function PersonalDetailsStep({
  formData,
  fieldErrors,
  onChange,
}: RegisterStepProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-gray-900 dark:text-white">
        {t("auth.stepPersonalDetails")}
      </h3>

      <div>
        <label
          htmlFor="register-dateOfBirth"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t("auth.dateOfBirth")} *
        </label>
        <input
          id="register-dateOfBirth"
          type="date"
          className={fieldClass(fieldErrors, "dateOfBirth")}
          aria-invalid={!!fieldErrors.dateOfBirth}
          aria-describedby={fieldErrors.dateOfBirth ? "dateOfBirth-error" : undefined}
          value={formData.dateOfBirth}
          onChange={(e) => onChange("dateOfBirth", e.target.value)}
        />
        <FieldErrorText id="dateOfBirth-error" message={fieldErrors.dateOfBirth} />
      </div>

      <div>
        <label
          htmlFor="register-gender"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t("auth.gender")} *
        </label>
        <select
          id="register-gender"
          className={fieldClass(fieldErrors, "gender")}
          aria-invalid={!!fieldErrors.gender}
          aria-describedby={fieldErrors.gender ? "gender-error" : undefined}
          value={formData.gender}
          onChange={(e) => onChange("gender", e.target.value)}
        >
          <option value="">{t("auth.selectGender")}</option>
          <option value="male">{t("auth.genderMale")}</option>
          <option value="female">{t("auth.genderFemale")}</option>
          <option value="other">{t("auth.genderOther")}</option>
        </select>
        <FieldErrorText id="gender-error" message={fieldErrors.gender} />
      </div>

      <div>
        <label
          htmlFor="register-aadhaarNumber"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t("auth.aadhaarNumber")}
        </label>
        <input
          id="register-aadhaarNumber"
          type="text"
          inputMode="numeric"
          className={fieldClass(fieldErrors, "aadhaarNumber")}
          aria-invalid={!!fieldErrors.aadhaarNumber}
          aria-describedby="aadhaarNumber-error aadhaarNumber-hint"
          value={formData.aadhaarNumber}
          onChange={(e) => onChange("aadhaarNumber", e.target.value)}
          placeholder="12-digit Aadhaar number"
        />
        <FieldErrorText id="aadhaarNumber-error" message={fieldErrors.aadhaarNumber} />
        <p id="aadhaarNumber-hint" className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {t("auth.aadhaarHint")}
        </p>
      </div>
    </div>
  );
}
