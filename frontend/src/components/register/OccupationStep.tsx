/**
 * Step 4: Native address + occupation (state, district, occupation, experience).
 * Extracted verbatim from WorkerRegisterPage (behaviour unchanged); inputs
 * given explicit id/htmlFor label associations for screen readers.
 */
import { useTranslation } from "react-i18next";
import FieldErrorText from "./FieldErrorText";
import { fieldClass, INDIAN_STATES, type RegisterStepProps } from "./constants";

export default function OccupationStep({ formData, fieldErrors, onChange }: RegisterStepProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-gray-900 dark:text-white">{t("auth.stepOccupation")}</h3>

      <div>
        <label
          htmlFor="register-nativeState"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t("auth.nativeState")}
        </label>
        <select
          id="register-nativeState"
          className="input-field"
          aria-describedby="nativeState-hint"
          value={formData.nativeState}
          onChange={(e) => onChange("nativeState", e.target.value)}
        >
          <option value="">{t("auth.selectHomeState")}</option>
          {INDIAN_STATES.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
        <p id="nativeState-hint" className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {t("auth.nativeStateHint")}
        </p>
      </div>

      <div>
        <label
          htmlFor="register-nativeDistrict"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t("auth.nativeDistrict")}
        </label>
        <input
          id="register-nativeDistrict"
          className="input-field"
          value={formData.nativeDistrict}
          onChange={(e) => onChange("nativeDistrict", e.target.value)}
          placeholder="Home district"
        />
      </div>

      <div>
        <label
          htmlFor="register-occupation"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t("auth.occupation")} *
        </label>
        <select
          id="register-occupation"
          className={fieldClass(fieldErrors, "occupation")}
          aria-invalid={!!fieldErrors.occupation}
          aria-describedby={fieldErrors.occupation ? "occupation-error" : undefined}
          value={formData.occupation}
          onChange={(e) => onChange("occupation", e.target.value)}
        >
          <option value="">{t("auth.selectOccupation")}</option>
          <option value="construction">{t("auth.occupationConstruction")}</option>
          <option value="domestic_work">{t("auth.occupationDomestic")}</option>
          <option value="agriculture">{t("auth.occupationAgriculture")}</option>
          <option value="textile_garment">{t("auth.occupationTextile")}</option>
          <option value="factory_worker">{t("auth.occupationFactory")}</option>
          <option value="driver_transport">{t("auth.occupationDriver")}</option>
          <option value="street_vendor">{t("auth.occupationVendor")}</option>
          <option value="security_guard">{t("auth.occupationSecurity")}</option>
          <option value="hospitality">{t("auth.occupationHospitality")}</option>
          <option value="other">{t("auth.occupationOther")}</option>
        </select>
        <FieldErrorText id="occupation-error" message={fieldErrors.occupation} />
      </div>

      <div>
        <label
          htmlFor="register-yearsOfExperience"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t("auth.yearsOfExperience")} *
        </label>
        <input
          id="register-yearsOfExperience"
          type="number"
          min="0"
          max="80"
          className={fieldClass(fieldErrors, "yearsOfExperience")}
          aria-invalid={!!fieldErrors.yearsOfExperience}
          aria-describedby={fieldErrors.yearsOfExperience ? "yearsOfExperience-error" : undefined}
          value={formData.yearsOfExperience}
          onChange={(e) => onChange("yearsOfExperience", e.target.value)}
          placeholder="Years"
        />
        <FieldErrorText id="yearsOfExperience-error" message={fieldErrors.yearsOfExperience} />
      </div>
    </div>
  );
}
