import { FormEvent, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Screen } from "../components/Screen";
import { api, apiErrorDetail } from "../api/client";
import { useAuth } from "../store/AuthContext";
import { Smartphone, KeyRound, AlertCircle, Loader2 } from "lucide-react";

type LoginMode = "password" | "otp";

export default function WorkerLoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { loginWithToken } = useAuth();

  const [mode, setMode] = useState<LoginMode>("otp");
  const [mobileNumber, setMobileNumber] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  const mobileRef = useRef<HTMLInputElement>(null);
  const otpRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const otpSentRef = useRef(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    // Get values from refs as backup (in case React state didn't update on mobile)
    const mobile = mobileRef.current?.value || mobileNumber;
    const otpVal = otpRef.current?.value || otp;
    const passVal = passwordRef.current?.value || password;

    const sanitizedMobile = mobile.replace(/\D/g, "");

    if (!sanitizedMobile || sanitizedMobile.length < 10) {
      setError(t("auth.invalidMobile"));
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "otp") {
        // Step 1: send the OTP first (field is still empty at this point, so
        // the send must not be gated on the code being present).
        if (!otpSentRef.current) {
          await api.post("/auth/worker/login/otp/request", {
            mobile_number: sanitizedMobile,
          });
          // OTP delivery is server-side only (backend terminal / SMS in
          // production) — never echoed in API responses or shown in the UI.
          otpSentRef.current = true;
          setOtpSent(true);
          setError(null);
          setSubmitting(false);
          otpRef.current?.focus();
          return;
        }
        // Step 2: verify the code the user typed.
        if (!otpVal) {
          setError(t("auth.otpRequired"));
          setSubmitting(false);
          return;
        }
        const res = await api.post("/auth/worker/login/otp", {
          mobile_number: sanitizedMobile,
          otp: otpVal,
        });
        loginWithToken(res.data.access_token, res.data.worker);
        navigate("/worker/dashboard");
      } else {
        if (!passVal) {
          setError(t("auth.enterPassword"));
          setSubmitting(false);
          return;
        }
        const res = await api.post("/auth/worker/login", {
          mobile_number: sanitizedMobile,
          password: passVal,
        });
        loginWithToken(res.data.access_token, res.data.worker);
        navigate("/worker/dashboard");
      }
    } catch (err) {
      setError(
        apiErrorDetail(err) ||
          (err instanceof Error ? err.message : null) ||
          t("auth.invalidCredentials"),
      );
      console.error("Login error:", err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen title={t("auth.login")} onBack={true}>
      {/* Mode Toggle */}
      <div className="flex bg-gray-100 dark:bg-gray-800 rounded-2xl p-1 mb-6 animate-fade-up">
        <button
          type="button"
          onClick={() => {
            setMode("otp");
            setError(null);
            otpSentRef.current = false;
            setOtpSent(false);
          }}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 ${
            mode === "otp"
              ? "bg-brand-600 text-white shadow-glow-brand"
              : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          <Smartphone className="h-4 w-4" aria-hidden="true" /> {t("auth.otpLogin")}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("password");
            setError(null);
            otpSentRef.current = false;
            setOtpSent(false);
          }}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 ${
            mode === "password"
              ? "bg-brand-600 text-white shadow-glow-brand"
              : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          <KeyRound className="h-4 w-4" aria-hidden="true" /> {t("auth.passwordLogin")}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Mobile Number */}
        <div>
          <label
            htmlFor="login-mobile"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {t("auth.mobileNumber")}
          </label>
          <input
            ref={mobileRef}
            id="login-mobile"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="tel"
            required
            className="input-field"
            value={mobileNumber}
            onChange={(e) => setMobileNumber(e.target.value.replace(/\D/g, ""))}
            placeholder="9876543210"
            maxLength={10}
          />
        </div>

        {/* OTP field */}
        {mode === "otp" && (
          <div>
            <label
              htmlFor="login-otp"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t("auth.otpCode")}
            </label>
            <input
              ref={otpRef}
              id="login-otp"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              className="input-field"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder={t("auth.otpPlaceholder")}
              maxLength={6}
            />
            {otpSent && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t("auth.otpSentNotice")}
              </p>
            )}
          </div>
        )}

        {/* Password field */}
        {mode === "password" && (
          <div>
            <label
              htmlFor="login-password"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t("auth.password")}
            </label>
            <input
              ref={passwordRef}
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              className="input-field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
            />
          </div>
        )}

        {error && (
          <div
            className="bg-red-50 dark:bg-red-900/20 border border-red-200/70 dark:border-red-800 rounded-xl p-3 animate-scale-in"
            role="alert"
          >
            <p className="text-red-600 dark:text-red-400 text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
              {error}
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="btn-primary mt-2 w-full shadow-glow-brand hover:shadow-glow-brand-lg"
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> {t("auth.loggingIn")}
            </span>
          ) : mode === "otp" && otpSent ? (
            t("auth.verifyButton")
          ) : (
            t("auth.loginButton")
          )}
        </button>
      </form>

      <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-6">
        {t("auth.noAccount")}{" "}
        <button
          onClick={() => navigate("/worker/register")}
          className="text-brand-600 dark:text-brand-400 font-semibold"
        >
          {t("auth.createAccount")}
        </button>
      </p>

      {/* Account backup: lost phone and/or lost password (recovery key). */}
      <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-2">
        Lost your phone or password?{" "}
        <button
          onClick={() => navigate("/worker/recover")}
          className="text-brand-600 dark:text-brand-400 font-semibold"
        >
          Recover with your recovery key
        </button>
      </p>
    </Screen>
  );
}
