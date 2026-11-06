import { FormEvent, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle, Home, Loader2, Lock, Phone, User } from "lucide-react";
import { Screen } from "../components/Screen";
import { api, setCitizenToken, apiErrorDetail } from "../api/client";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";

type Mode = "register" | "password" | "otp";

interface CitizenResponse {
  access_token: string;
  citizen: {
    id: string;
    full_name: string;
    mobile_number: string;
    role: string;
    current_village_or_city: string | null;
    current_district: string | null;
    current_state: string | null;
  };
}

export default function CitizenLoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("register");
  const [fullName, setFullName] = useState("");
  const [area, setArea] = useState("");
  const [district, setDistrict] = useState("");
  const [stateName, setStateName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [pendingMobile, setPendingMobile] = useState<string | null>(null);

  const finishLogin = useCallback(
    (data: CitizenResponse) => {
      setCitizenToken(data.access_token);
      localStorage.setItem("citizen_user", JSON.stringify(data.citizen));
      navigate("/citizen/dashboard", { replace: true });
    },
    [navigate],
  );

  const resetFlow = (next: Mode) => {
    setMode(next);
    setError(null);
    setOtpSent(false);
    setOtp("");
  };

  const digitsOnly = (v: string) => v.replace(/\D/g, "").slice(0, 10);

  const submitRegister = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ recovery_key: string }>("/auth/citizen/register", {
        full_name: fullName.trim(),
        mobile_number: digitsOnly(mobileNumber),
        password,
        current_village_or_city: area.trim() || undefined,
        current_district: district.trim() || undefined,
        current_state: stateName.trim() || undefined,
      });
      setRecoveryKey(res.data.recovery_key);
      setPendingMobile(digitsOnly(mobileNumber));
    } catch (err) {
      setError(apiErrorDetail(err) || t("citizen.registerFailed", "Registration failed."));
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<CitizenResponse>(path, {
        mobile_number: digitsOnly(mobileNumber),
        otp: otp.replace(/\D/g, ""),
      });
      finishLogin(res.data);
    } catch (err) {
      setError(apiErrorDetail(err) || t("citizen.verifyFailed", "Verification failed."));
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<CitizenResponse>("/auth/citizen/login", {
        mobile_number: digitsOnly(mobileNumber),
        password,
      });
      finishLogin(res.data);
    } catch (err) {
      setError(
        apiErrorDetail(err) || t("citizen.invalidLogin", "Invalid mobile number or password."),
      );
    } finally {
      setBusy(false);
    }
  };

  const requestOtpLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/citizen/login/otp/request", {
        mobile_number: digitsOnly(mobileNumber),
      });
      setOtpSent(true);
    } catch (err) {
      setError(apiErrorDetail(err) || t("citizen.otpFailed", "Could not send OTP."));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (recoveryKey && pendingMobile) return void submitOtp("/auth/citizen/otp/verify");
    if (mode === "register") return void submitRegister();
    if (mode === "password") return void submitPassword();
    if (!otpSent) return void requestOtpLogin();
    void submitOtp("/auth/citizen/login/otp");
  };

  return (
    <Screen title={t("citizen.title", "Household")} onBack={true}>
      <div className="max-w-md mx-auto">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-blue-600 flex items-center justify-center shadow-lg shadow-brand-600/25 mb-4">
            <Home className="h-7 w-7 text-white" aria-hidden="true" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("citizen.heading", "ShramSetu Household")}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t(
              "citizen.tagline",
              "Find a verified worker near you — they call you back, never public numbers",
            )}
          </p>
        </div>

        <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 mb-6">
          {(["register", "password", "otp"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => resetFlow(m)}
              className={`flex-1 py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                mode === m
                  ? "bg-white shadow-sm text-brand-700 dark:text-brand-400"
                  : "text-gray-600 dark:text-gray-300"
              }`}
            >
              {m === "register" ? (
                <User className="h-3.5 w-3.5" aria-hidden="true" />
              ) : m === "password" ? (
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Phone className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {m === "register"
                ? t("citizen.tabRegister", "Create account")
                : m === "password"
                  ? t("citizen.tabPassword", "Password")
                  : t("citizen.tabOtp", "OTP login")}
            </button>
          ))}
        </div>

        {recoveryKey && pendingMobile && (
          <Card className="p-6 space-y-4">
            {[
              <div key="a" className="flex items-center gap-3">
                <AlertCircle
                  className="h-5 w-5 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                <h3 className="font-bold text-gray-900 dark:text-gray-100">
                  {t("citizen.recoveryTitle", "Save this recovery key")}
                </h3>
              </div>,
            ]}
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t(
                "citizen.recoveryBody",
                "Shown only once — it recovers this account if you lose your phone number.",
              )}
            </p>
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl p-4 font-mono text-lg font-bold tracking-widest text-gray-900 dark:text-brand-300 select-all break-all">
              {recoveryKey}
            </div>
            <Button
              onClick={() => {
                setRecoveryKey(null);
                setBusy(false);
              }}
              className="w-full"
            >
              {t("citizen.savedKey", "I saved my recovery key — continue to OTP")}
            </Button>
          </Card>
        )}

        {!recoveryKey && (
          <Card className="p-6 space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "register" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t("citizen.yourName", "Your name")}
                    </label>
                    <input
                      className="input-field w-full"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                      placeholder={t("citizen.namePlaceholder", "Valsa Thomas")}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      className="input-field w-full"
                      value={area}
                      onChange={(e) => setArea(e.target.value)}
                      placeholder={t("citizen.areaPlaceholder", "Area / village")}
                    />
                    <input
                      className="input-field w-full"
                      value={district}
                      onChange={(e) => setDistrict(e.target.value)}
                      placeholder={t("citizen.districtPlaceholder", "District")}
                    />
                    <input
                      className="input-field w-full"
                      value={stateName}
                      onChange={(e) => setStateName(e.target.value)}
                      placeholder={t("citizen.statePlaceholder", "State")}
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("citizen.mobile", "Mobile number")}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    +91
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="input-field w-full pl-10"
                    value={mobileNumber}
                    onChange={(e) => setMobileNumber(digitsOnly(e.target.value))}
                    placeholder="9876543210"
                    required
                    maxLength={10}
                  />
                </div>
              </div>

              {mode !== "otp" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t("citizen.password", "Password")}
                  </label>
                  <input
                    type="password"
                    className="input-field w-full"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder={
                      mode === "register"
                        ? t("citizen.newPassword", "At least 6 characters")
                        : t("citizen.yourPassword", "Your password")
                    }
                  />
                </div>
              )}

              {mode === "otp" && otpSent && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t("citizen.otpLabel", "OTP sent to your mobile")}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="input-field w-full"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="••••••"
                    required
                    maxLength={6}
                  />
                </div>
              )}

              {error && (
                <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 p-3">
                  <p className="text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" /> {error}
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="btn-primary w-full shadow-glow-brand"
              >
                {busy ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />{" "}
                    {t("common.loading", "Working…")}
                  </span>
                ) : mode === "register" ? (
                  <span className="flex items-center justify-center gap-2">
                    <User className="h-4 w-4" aria-hidden="true" />{" "}
                    {t("citizen.createAccount", "Create household account")}
                  </span>
                ) : mode === "otp" && !otpSent ? (
                  <span className="flex items-center justify-center gap-2">
                    <Phone className="h-4 w-4" aria-hidden="true" />{" "}
                    {t("citizen.sendOtp", "Send OTP")}
                  </span>
                ) : mode === "otp" ? (
                  <span className="flex items-center justify-center gap-2">
                    <CheckCircle className="h-4 w-4" aria-hidden="true" />{" "}
                    {t("citizen.verifyOtp", "Verify OTP")}
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <Lock className="h-4 w-4" aria-hidden="true" /> {t("citizen.logIn", "Log in")}
                  </span>
                )}
              </button>
            </form>
          </Card>
        )}

        <p className="text-center text-xs text-gray-500 dark:text-gray-400 mt-4">
          {t(
            "citizen.privacyNote",
            "Your account is not a worker account: no registration approval is needed. Phone numbers pass between you and a worker only after that worker accepts your request.",
          )}
        </p>
      </div>
    </Screen>
  );
}
