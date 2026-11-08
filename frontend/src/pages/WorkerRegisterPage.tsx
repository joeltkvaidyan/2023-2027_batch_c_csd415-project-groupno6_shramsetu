import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Screen } from "../components/Screen";
import { api } from "../api/client";
import { useAuth } from "../store/AuthContext";
import { AlertCircle, Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import BasicInfoStep from "../components/register/BasicInfoStep";
import PersonalDetailsStep from "../components/register/PersonalDetailsStep";
import AddressStep from "../components/register/AddressStep";
import OccupationStep from "../components/register/OccupationStep";
import EmergencyContactStep from "../components/register/EmergencyContactStep";
import OtpPhase from "../components/register/OtpPhase";
import {
  EMPTY_FORM,
  STEPS,
  type RegistrationFormData,
  type RegistrationResponse,
} from "../components/register/constants";

/**
 * Worker registration wizard: owns the multi-step form state, per-step
 * validation and submission. The field groups render via components in
 * components/register/ (extracted verbatim — behaviour unchanged).
 */
export default function WorkerRegisterPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { completeLogin } = useAuth();

  const [currentStep, setCurrentStep] = useState(0);
  const [phase, setPhase] = useState<"form" | "recovery" | "otp">("form");
  const [formData, setFormData] = useState<RegistrationFormData>(EMPTY_FORM);
  const [keyCopied, setKeyCopied] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [otp, setOtp] = useState("");
  const [registrationData, setRegistrationData] = useState<RegistrationResponse | null>(null);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFormData({
        ...formData,
        photo: file,
        photoPreview: URL.createObjectURL(file),
      });
    }
  };

  const handleInputChange = (field: keyof RegistrationFormData, value: string | boolean) => {
    setFormData({
      ...formData,
      [field]: value,
    });
    if (fieldErrors[field as string]) {
      setFieldErrors((f) => {
        const next = { ...f };
        delete next[field as string];
        return next;
      });
    }
  };

  const validateStep = () => {
    const errs: Record<string, string> = {};
    switch (currentStep) {
      case 0: // Basic Info
        if (!formData.fullName.trim()) errs.fullName = t("common.required");
        if (!formData.mobileNumber.trim() || formData.mobileNumber.replace(/\D/g, "").length < 10) {
          errs.mobileNumber = t("auth.invalidMobile");
        }
        if (!formData.password || formData.password.length < 6) {
          errs.password = t("auth.passwordMinLength");
        }
        break;
      case 1: // Personal Details
        if (!formData.dateOfBirth) errs.dateOfBirth = t("common.required");
        if (!formData.gender) errs.gender = t("common.required");
        if (formData.aadhaarNumber && formData.aadhaarNumber.replace(/\D/g, "").length !== 12) {
          errs.aadhaarNumber = t("auth.aadhaarInvalid");
        }
        break;
      case 2: // Current Address
        if (!formData.currentVillageOrCity.trim()) errs.currentVillageOrCity = t("common.required");
        if (!formData.currentState) errs.currentState = t("common.required");
        if (formData.currentPincode && formData.currentPincode.length !== 6) {
          errs.currentPincode = t("auth.pincodeInvalid");
        }
        break;
      case 3: // Occupation
        if (!formData.occupation) errs.occupation = t("common.required");
        if (!formData.yearsOfExperience) errs.yearsOfExperience = t("common.required");
        break;
      case 4: // Emergency Contact + privacy consent
        if (!formData.emergencyContactName.trim()) errs.emergencyContactName = t("common.required");
        if (
          !formData.emergencyContactNumber.trim() ||
          formData.emergencyContactNumber.replace(/\D/g, "").length < 10
        ) {
          errs.emergencyContactNumber = t("auth.emergencyContactInvalid");
        }
        if (!formData.consentAiProcessing) {
          errs.consentAiProcessing = t("auth.consentRequired");
        }
        break;
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleNext = () => {
    setError(null);
    if (validateStep()) {
      if (currentStep < STEPS.length - 1) {
        setCurrentStep(currentStep + 1);
      }
    }
  };

  const handlePrevious = () => {
    setError(null);
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validateStep()) return;

    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("full_name", formData.fullName);
      form.append("mobile_number", formData.mobileNumber);
      form.append("password", formData.password);
      if (formData.email) form.append("email", formData.email);
      form.append("preferred_language", i18n.language || "en");
      if (formData.photo) form.append("profile_photo", formData.photo);

      if (formData.dateOfBirth) form.append("date_of_birth", formData.dateOfBirth);
      if (formData.gender) form.append("gender", formData.gender);
      if (formData.aadhaarNumber) form.append("aadhaar_number", formData.aadhaarNumber);

      if (formData.currentAddressLine)
        form.append("current_address_line", formData.currentAddressLine);
      if (formData.currentVillageOrCity)
        form.append("current_village_or_city", formData.currentVillageOrCity);
      if (formData.currentDistrict) form.append("current_district", formData.currentDistrict);
      if (formData.currentState) form.append("current_state", formData.currentState);
      if (formData.currentPincode) form.append("current_pincode", formData.currentPincode);

      if (formData.nativeState) form.append("native_state", formData.nativeState);
      if (formData.nativeDistrict) form.append("native_district", formData.nativeDistrict);

      if (formData.occupation) form.append("occupation", formData.occupation);
      if (formData.yearsOfExperience)
        form.append("years_of_experience", formData.yearsOfExperience);

      if (formData.emergencyContactName)
        form.append("emergency_contact_name", formData.emergencyContactName);
      if (formData.emergencyContactRelation)
        form.append("emergency_contact_relation", formData.emergencyContactRelation);
      if (formData.emergencyContactNumber)
        form.append("emergency_contact_number", formData.emergencyContactNumber);

      const res = await api.post<RegistrationResponse>("/auth/worker/register", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      // Registration successful. BEFORE the OTP screen, show the recovery key
      // exactly once — the backup if the worker ever loses their phone AND
      // password. Only a hash is stored server-side; this response is the
      // only copy the worker will ever receive.
      setRegistrationData(res.data);
      setPhase(res.data.recovery_key ? "recovery" : "otp");
    } catch {
      setError(t("auth.registrationFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleOtpSubmit = async () => {
    if (!otp || !registrationData) {
      setError(t("auth.otpRequired"));
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post("/auth/worker/otp/verify", {
        mobile_number: registrationData.mobile_number,
        otp: otp,
      });

      completeLogin(res.data.worker);
      navigate("/worker/dashboard");
    } catch {
      setError(t("auth.otpInvalid"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen
      title={phase === "form" ? t("auth.register") : "Verify Phone"}
      onBack={phase === "form" ? (currentStep === 0 ? true : () => handlePrevious()) : true}
    >
      <div className="mt-4">
        {phase === "form" ? (
          <>
            {/* FORM PHASE */}
            {/* Step indicator — numbered rail with connected progress line */}
            <div className="mb-6">
              <div className="flex justify-between items-center">
                {STEPS.map((_, idx) => (
                  <div key={idx} className="flex items-center">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300 ${
                        idx === currentStep
                          ? "bg-brand-600 text-white shadow-glow-brand scale-110"
                          : idx < currentStep
                            ? "bg-brand-100 dark:bg-brand-900/60 text-brand-700 dark:text-brand-300"
                            : "bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                      }`}
                    >
                      {idx < currentStep ? (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        idx + 1
                      )}
                    </div>
                    {idx < STEPS.length - 1 && (
                      <div
                        className={`h-1 flex-1 ml-2 mr-2 rounded-full transition-colors duration-300 ${
                          idx < currentStep ? "bg-brand-500" : "bg-gray-200 dark:bg-gray-700"
                        }`}
                      />
                    )}
                  </div>
                ))}
              </div>
              <p className="text-center text-xs text-gray-600 dark:text-gray-400 mt-2">
                {t("auth.stepOfTotal", {
                  current: currentStep + 1,
                  total: STEPS.length,
                })}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Step 1: Basic Info */}
              {currentStep === 0 && (
                <BasicInfoStep
                  formData={formData}
                  fieldErrors={fieldErrors}
                  onChange={handleInputChange}
                  onPhotoChange={handlePhotoChange}
                />
              )}

              {/* Step 2: Personal Details */}
              {currentStep === 1 && (
                <PersonalDetailsStep
                  formData={formData}
                  fieldErrors={fieldErrors}
                  onChange={handleInputChange}
                />
              )}

              {/* Step 3: Current Address */}
              {currentStep === 2 && (
                <AddressStep
                  formData={formData}
                  fieldErrors={fieldErrors}
                  onChange={handleInputChange}
                />
              )}

              {/* Step 4: Occupation */}
              {currentStep === 3 && (
                <OccupationStep
                  formData={formData}
                  fieldErrors={fieldErrors}
                  onChange={handleInputChange}
                />
              )}

              {/* Step 5: Emergency Contact */}
              {currentStep === 4 && (
                <EmergencyContactStep
                  formData={formData}
                  fieldErrors={fieldErrors}
                  onChange={handleInputChange}
                />
              )}

              {error && (
                <p className="text-red-600 dark:text-red-400 text-sm p-3 bg-red-50 dark:bg-red-900/20 border border-red-200/70 dark:border-red-800 rounded-xl flex items-start gap-2 animate-scale-in">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                  {error}
                </p>
              )}

              {/* Navigation Buttons */}
              <div className="flex gap-3 mt-6">
                {currentStep > 0 && (
                  <button
                    type="button"
                    onClick={handlePrevious}
                    className="flex-1 btn-secondary flex items-center justify-center gap-1"
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                    {t("auth.previous")}
                  </button>
                )}

                {currentStep < STEPS.length - 1 ? (
                  <button
                    type="button"
                    onClick={handleNext}
                    className="flex-1 btn-primary flex items-center justify-center gap-1"
                  >
                    {t("auth.next")}
                    <ChevronRight className="h-5 w-5" aria-hidden="true" />
                  </button>
                ) : (
                  <button type="submit" disabled={submitting} className="flex-1 btn-primary">
                    {submitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />{" "}
                        {t("auth.registering")}
                      </span>
                    ) : (
                      t("auth.createAccount")
                    )}
                  </button>
                )}
              </div>
            </form>

            <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-6">
              {t("auth.haveAccount")}{" "}
              <button
                onClick={() => navigate("/worker/login")}
                className="text-brand-600 dark:text-brand-400 font-semibold"
              >
                {t("auth.login")}
              </button>
            </p>
          </>
        ) : phase === "recovery" && registrationData?.recovery_key ? (
          /* ── Recovery key shown exactly once (hash-only server-side) ── */
          <div className="space-y-4 animate-fade-up" data-testid="recovery-key-screen">
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-800 rounded-2xl p-5 text-center">
              <p className="text-amber-900 dark:text-amber-200 font-bold">Back up your account</p>
              <p className="text-amber-800 dark:text-amber-300 text-sm mt-1">
                If you ever lose your phone AND your password, this key is the only way to recover
                your account. Write it on paper now — it is shown only this once.
              </p>
              <div className="mt-3 py-3 px-2 bg-white dark:bg-gray-900 rounded-xl font-mono text-lg font-bold tracking-widest text-gray-900 dark:text-brand-300 select-all">
                {registrationData.recovery_key}
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(registrationData.recovery_key!);
                    setKeyCopied(true);
                    setTimeout(() => setKeyCopied(false), 1600);
                  } catch {
                    /* clipboard unavailable — the key is visible above */
                  }
                }}
                className="mt-3 text-sm font-semibold text-amber-900 dark:text-amber-200 underline"
              >
                {keyCopied ? "Copied ✓" : "Copy the key"}
              </button>
            </div>
            <button type="button" onClick={() => setPhase("otp")} className="btn-primary w-full">
              I have saved my recovery key — continue
            </button>
          </div>
        ) : (
          <OtpPhase
            registrationData={registrationData}
            otp={otp}
            setOtp={setOtp}
            submitting={submitting}
            error={error}
            onSubmit={handleOtpSubmit}
          />
        )}
      </div>
    </Screen>
  );
}
