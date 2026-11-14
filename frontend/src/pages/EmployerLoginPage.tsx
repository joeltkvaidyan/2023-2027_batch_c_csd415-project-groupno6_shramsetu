import { FormEvent, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  Building2,
  CheckCircle,
  KeyRound,
  Loader2,
  Lock,
  Phone,
  UserPlus,
} from "lucide-react";
import { Screen } from "../components/Screen";
import { api, apiErrorDetail } from "../api/client";
import { declareSession } from "../api/session";
import { Card } from "../components/ui/Card";

type Mode = "password" | "otp";

interface EmployerResponse {
  access_token: string;
  employer: { id: string; full_name: string; business_name: string | null; mobile_number: string };
}

/**
 * Employer sign-in. Account creation lives on its own page (/employer/register)
 * exactly like the worker flow, so "log in" here never doubles as a form that
 * silently registers someone.
 */
export default function EmployerLoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("password");
  const [mobileNumber, setMobileNumber] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digitsOnly = (v: string) => v.replace(/\D/g, "").slice(0, 10);
  const mobile = digitsOnly(mobileNumber);

  const finishLogin = useCallback(
    (data: EmployerResponse) => {
      declareSession("employer");
      localStorage.setItem("employer_user", JSON.stringify(data.employer));
      navigate("/employer/dashboard", { replace: true });
    },
    [navigate],
  );

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setOtpSent(false);
    setOtp("");
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mobile.length !== 10) return setError("Enter your 10-digit mobile number.");

    setBusy(true);
    try {
      if (mode === "password") {
        const res = await api.post<EmployerResponse>("/auth/employer/login", {
          mobile_number: mobile,
          password,
        });
        return finishLogin(res.data);
      }

      if (!otpSent) {
        await api.post("/auth/employer/login/otp/request", { mobile_number: mobile });
        setOtpSent(true);
        return;
      }

      const res = await api.post<EmployerResponse>("/auth/employer/login/otp", {
        mobile_number: mobile,
        otp: otp.replace(/\D/g, ""),
      });
      finishLogin(res.data);
    } catch (err) {
      const detail = apiErrorDetail(err);
      setError(
        typeof detail === "string"
          ? detail
          : mode === "password"
            ? "Invalid mobile number or password."
            : "Verification failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Employer" onBack={true}>
      <div className="max-w-md mx-auto">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-blue-600 flex items-center justify-center shadow-lg shadow-brand-600/25 mb-4">
            <Building2 className="h-7 w-7 text-white" aria-hidden="true" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            ShramSetu Employer
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Find workers, see their number and call them about work
          </p>
        </div>

        <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 mb-6">
          {(["password", "otp"] as Mode[]).map((m) => {
            const active = mode === m;
            const Icon = m === "password" ? Lock : Phone;
            return (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={`flex-1 py-2.5 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 ${
                  active
                    ? "bg-white shadow-sm text-brand-700 dark:text-brand-400"
                    : "text-gray-600 dark:text-gray-300"
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {m === "password" ? "Password login" : "OTP login"}
              </button>
            );
          })}
        </div>

        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="emp-login-mobile"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Mobile number
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">+91</span>
                <input
                  id="emp-login-mobile"
                  type="text"
                  inputMode="numeric"
                  className="input-field w-full pl-12"
                  value={mobileNumber}
                  onChange={(e) => setMobileNumber(digitsOnly(e.target.value))}
                  placeholder="9876543210"
                  required
                  maxLength={10}
                  autoComplete="tel"
                />
              </div>
            </div>

            {mode === "password" && (
              <div>
                <label
                  htmlFor="emp-login-password"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Password
                </label>
                <div className="relative">
                  <KeyRound
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4"
                    aria-hidden="true"
                  />
                  <input
                    id="emp-login-password"
                    type="password"
                    className="input-field w-full pl-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your password"
                    required
                    minLength={6}
                    autoComplete="current-password"
                  />
                </div>
              </div>
            )}

            {mode === "otp" && otpSent && (
              <div>
                <label
                  htmlFor="emp-login-otp"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  OTP sent to your mobile
                </label>
                <input
                  id="emp-login-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="input-field w-full text-center text-lg tracking-[0.4em]"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="••••••"
                  maxLength={6}
                  required
                />
              </div>
            )}

            {error && (
              <div
                className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 p-3"
                role="alert"
              >
                <p className="text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" /> {error}
                </p>
              </div>
            )}

            <button type="submit" disabled={busy} className="btn-primary w-full shadow-glow-brand">
              {busy ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Working…
                </span>
              ) : mode === "otp" && !otpSent ? (
                <span className="flex items-center justify-center gap-2">
                  <Phone className="h-4 w-4" aria-hidden="true" /> Send OTP
                </span>
              ) : mode === "otp" ? (
                <span className="flex items-center justify-center gap-2">
                  <CheckCircle className="h-4 w-4" aria-hidden="true" /> Verify OTP
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Lock className="h-4 w-4" aria-hidden="true" /> Log in
                </span>
              )}
            </button>
          </form>
        </Card>

        <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-4">
          New here?{" "}
          <button
            type="button"
            onClick={() => navigate("/employer/register")}
            className="text-brand-600 dark:text-brand-400 font-semibold inline-flex items-center gap-1"
          >
            <UserPlus className="h-3.5 w-3.5" aria-hidden="true" /> Create an employer account
          </button>
        </p>

        {import.meta.env.DEV && (
          <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-3">
            Demo employer: 9000000021 · Employer@123
            <br />
            Demo household: 9000000022 · Household@123
          </p>
        )}
      </div>
    </Screen>
  );
}
