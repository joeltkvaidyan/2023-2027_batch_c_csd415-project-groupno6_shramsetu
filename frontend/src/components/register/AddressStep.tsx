/**
 * Step 3: Current address (line, village/city, district, state, pincode).
 * Extracted verbatim from WorkerRegisterPage (behaviour unchanged); inputs
 * given explicit id/htmlFor label associations for screen readers.
 */
import { useTranslation } from "react-i18next";
import FieldErrorText from "./FieldErrorText";
import { fieldClass, INDIAN_STATES, type RegisterStepProps } from "./constants";

export default function AddressStep({ formData, fieldErrors, onChange }: RegisterStepProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-gray-900 dark:text-white">{t("auth.currentAddress")}</h3>

      <div>
        <label
          htmlFor="register-currentAddressLine"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t("auth.addressLine")}
        </label>
        <input
          id="register-currentAddressLine"
          className="input-field"
          value={formData.currentAddressLine}
          onChange={(e) => onChange("currentAddressLine", e.target.value)}
          placeholder="House no., street name"
        />
      </div>

      <div>
        <label
          htmlFor="register-currentVillageOrCity"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t("auth.villageOrCity")} *
        </label>
        <input
          id="register-currentVillageOrCity"
          className={fieldClass(fieldErrors, "currentVillageOrCity")}
          aria-invalid={!!fieldErrors.currentVillageOrCity}
          aria-describedby={
            fieldErrors.currentVillageOrCity ? "currentVillageOrCity-error" : undefined
          }
          value={formData.currentVillageOrCity}
          onChange={(e) => onChange("currentVillageOrCity", e.target.value)}
          placeholder="Village or city name"
        />
        <FieldErrorText
          id="currentVillageOrCity-error"
          message={fieldErrors.currentVillageOrCity}
        />
      </div>

      <div>
        <label
          htmlFor="register-currentDistrict"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t("auth.district")}
        </label>
        <input
          id="register-currentDistrict"
          className="input-field"
          value={formData.currentDistrict}
          onChange={(e) => onChange("currentDistrict", e.target.value)}
          placeholder="District"
        />
      </div>

      <div>
        <label
          htmlFor="register-currentState"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t("auth.state")} *
        </label>
        <select
          id="register-currentState"
          className={fieldClass(fieldErrors, "currentState")}
          aria-invalid={!!fieldErrors.currentState}
          aria-describedby={fieldErrors.currentState ? "currentState-error" : undefined}
          value={formData.currentState}
          onChange={(e) => onChange("currentState", e.target.value)}
        >
          <option value="">{t("auth.selectState")}</option>
          {INDIAN_STATES.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
        <FieldErrorText id="currentState-error" message={fieldErrors.currentState} />
      </div>

      <div>
        <label
          htmlFor="register-currentPincode"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t("auth.pincode")}
        </label>
        <input
          id="register-currentPincode"
          type="text"
          inputMode="numeric"
          maxLength={6}
          className={fieldClass(fieldErrors, "currentPincode")}
          aria-invalid={!!fieldErrors.currentPincode}
          aria-describedby={fieldErrors.currentPincode ? "currentPincode-error" : undefined}
          value={formData.currentPincode}
          onChange={(e) => onChange("currentPincode", e.target.value)}
          placeholder="6-digit pincode"
        />
        <FieldErrorText id="currentPincode-error" message={fieldErrors.currentPincode} />
      </div>
    </div>
  );
}
