import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Loader2 } from "lucide-react";
import { Screen } from "../components/Screen";
import { api, setEmployerToken } from "../api/client";
import type { Worker } from "../types";

/**
 * Employer accounts: sign up with mobile + password (OTP delivered only to
 * the backend terminal in dev) or password/OTP login. Registration shows the
 * recovery key exactly once — the same backup scheme as workers.
 */
type Mode = "otp" | "password" | "register";
interface EmployerResponse {
  access_token: string;
  employer: Worker;
}

export default function EmployerLoginPage() {
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>("register");
  const [fullName, setFullName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Registration success screens.
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [pendingMobile, setPendingMobile] = useState<string | null>(null);
  const [recoveryCopied, setRecoveryCopied] = useState(false);

  const finishLogin = (data: EmployerResponse) => {
    setEmployerToken(data.access_token);
    localStorage.setItem("employer_user", JSON.stringify(data.employer));
    navigate("/employer/dashboard");
  };

  const resetFlow = (next: Mode) => {
    setMode(next);
    setError(null);
    setOtpSent(false);
    setOtp("");
  };

  const submitRegister = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ recovery_key: string }>("/auth/employer/register", {
        full_name: fullName,
        mobile_number: mobileNumber.replace(/\D/g, ""),
        password,
      });
      setRecoveryKey(res.data.recovery_key);
      setPendingMobile(mobileNumber.replace(/\D/g, ""));
      // Wait for "I saved it" → then the OTP step.
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Registration failed.");
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<EmployerResponse>(path, {
        mobile_number: mobileNumber.replace(/\D/g, ""),
        otp: otp.replace(/\D/g, ""),
      });
      finishLogin(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Verification failed.");
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<EmployerResponse>("/auth/employer/login", {
        mobile_number: mobileNumber.replace(/\D/g, ""),
        password,
      });
      finishLogin(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Invalid mobile number or password.");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (recoveryKey && pendingMobile) return void submitOtp("/auth/employer/otp/verify");
    if (mode === "register") return void submitRegister();
    if (mode === "password") return void submitPassword();
    if (!otpSent) {
      setBusy(true);
      api
        .post("/auth/employer/login/otp/request", { mobile_number: mobileNumber.replace(/\D/g, "") })
        .then(() => {
          setOtpSent(true);
          setError(null);
        })
        .catch((err: any) => setError(err?.response?.data?.detail || "Could not send OTP."))
        .finally(() => setBusy(false));
      return;
    }
    void submitOtp("/auth/employer/login/otp");
  };

  return (
    <Screen title="Employer" onBack={true}>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Business accounts for hiring. Employers register with their mobile
        number — the OTP is printed in the backend terminal (dev mode).
      </p>

      {recoveryKey && pendingMobile ? (
        <div className="space-y-4">
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-800 rounded-2xl p-5 text-center">
            <p className="text-amber-900 dark:text-amber-200 font-bold">Back up your employer account</p>
            <p className="text-amber-800 dark:text-amber-300 text-sm mt-1">
              Shown only once — write it down. It recovers this account if you
              lose the phone and the password.
            </p>
            <div className="mt-3 py-3 px-2 bg-white dark:bg-gray-900 rounded-xl font-mono text-lg font-bold tracking-widest text-gray-900 dark:text-brand-300 select-all">
              {recoveryKey}
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(recoveryKey);
                  setRecoveryCopied(true);
                  setTimeout(() => setRecoveryCopied(false), 1600);
                } catch {
                  /* visible above */
                }
              }}
              className="mt-3 text-sm font-semibold text-amber-900 dark:text-amber-200 underline"
            >
              {recoveryCopied ? "Copied ✓" : "Copy the key"}
            </button>
          </div>
          <div>
            <label htmlFor="emp-otp" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              OTP sent to +91 {pendingMobile}
            </label>
            <input
              id="emp-otp"
              type="text"
              inputMode="numeric"
              className="input-field"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="6-digit code"
            />
          </div>
          <button onClick={handleSubmit} disabled={busy} className="btn-primary w-full">
            Verify and continue
          </button>
          <button
            onClick={() => {
              setRecoveryKey(null);
              setPendingMobile(null);
              resetFlow("password");
            }}
            className="btn-secondary w-full"
          >
            Back to login
          </button>
        </div>
      ) : (
        <>
          <div className="flex bg-gray-100 dark:bg-gray-800 rounded-2xl p-1 mb-6">
            {(["register", "password", "otp"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => resetFlow(m)}
                className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition ${
                  mode === m ? "bg-brand-600 text-white shadow-glow-brand" : "text-gray-600 dark:text-gray-300"
                }`}
              >
                {m === "register" ? "Register" : m === "password" ? "Password login" : "OTP login"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <div>
                <label htmlFor="emp-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Business / owner name
                </label>
                <input id="emp-name" className="input-field" value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="Ravi Constructions" />
              </div>
            )}

            <div>
              <label htmlFor="emp-mobile" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Mobile number
              </label>
              <input
                id="emp-mobile"
                type="text"
                inputMode="numeric"
                className="input-field"
                value={mobileNumber}
                onChange={(e) => setMobileNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="9876543210"
                required
              />
            </div>

            {mode !== "otp" && (
              <div>
                <label htmlFor="emp-pass" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {mode === "register" ? "Password" : "Password"}
                </label>
                <input
                  id="emp-pass"
                  type="password"
                  className="input-field"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder={mode === "register" ? "At least 6 characters" : "Your password"}
                />
              </div>
            )}

            {mode === "otp" && otpSent && (
              <div>
                <label htmlFor="emp-login-otp" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  OTP sent to your mobile
                </label>
                <input
                  id="emp-login-otp"
                  type="text"
                  inputMode="numeric"
                  className="input-field"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="6-digit code"
                  required
                />
              </div>
            )}

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200/70 dark:border-red-800 rounded-xl p-3" role="alert">
                <p className="text-red-600 dark:text-red-400 text-sm flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" /> {error}
                </p>
              </div>
            )}

            <button type="submit" disabled={busy} className="btn-primary w-full shadow-glow-brand">
              {busy ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Working…
                </span>
              ) : mode === "register" ? (
                "Create employer account"
              ) : mode === "otp" && !otpSent ? (
                "Send OTP"
              ) : mode === "otp" ? (
                "Verify OTP"
              ) : (
                "Log in"
              )}
            </button>
          </form>
        </>
      )}
    </Screen>
  );
}
