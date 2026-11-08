import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Building2, CheckCircle, Lock, Phone, User } from "lucide-react";
import { Screen } from "../components/Screen";
import { api, apiErrorDetail, httpStatus } from "../api/client";
import { declareSession } from "../api/session";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";

type Phase = "form" | "recovery" | "otp";

interface RegisterResponse {
  recovery_key?: string;
  resent?: boolean;
  detail?: string;
}

interface EmployerResponse {
  access_token: string;
  employer: { id: string; full_name: string; business_name: string | null; mobile_number: string };
}

/**
 * Employer sign-up — the hiring side's own account creation, kept separate
 * from login exactly like the worker flow. Three honest phases:
 *   1. the business + owner details (nothing is public yet),
 *   2. the one-time recovery key (shown once, stored only as a hash),
 *   3. OTP on the given mobile → straight into the dashboard.
 *
 * A new account is PENDING with the labour office, so the dashboard opens
 * with contact browsing available while posting and rating stay locked.
 */
export default function EmployerRegisterPage() {
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("form");
  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessState, setBusinessState] = useState("");
  const [businessDistrict, setBusinessDistrict] = useState("");
  const [businessCity, setBusinessCity] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digitsOnly = (v: string) => v.replace(/\D/g, "").slice(0, 10);
  const mobile = digitsOnly(mobileNumber);

  const submitRegister = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (fullName.trim().length < 2) return setError("Enter the owner or business contact name.");
    if (mobile.length !== 10 || !/^[6-9]/.test(mobile)) {
      return setError("Enter a valid 10-digit Indian mobile number.");
    }
    if (password.length < 6) return setError("Use a password of at least 6 characters.");

    setBusy(true);
    try {
      const res = await api.post<RegisterResponse>("/auth/employer/register", {
        full_name: fullName.trim(),
        mobile_number: mobile,
        password,
        business_name: businessName.trim() || undefined,
        business_state: businessState.trim() || undefined,
        business_district: businessDistrict.trim() || undefined,
        current_village_or_city: businessCity.trim() || undefined,
      });
      if (res.data.recovery_key) {
        setRecoveryKey(res.data.recovery_key);
        setPhase("recovery");
      } else {
        // Number already registered but never verified — a fresh OTP went out.
        setPhase("otp");
      }
    } catch (err) {
      const status = httpStatus(err);
      const detail = apiErrorDetail(err);
      setError(
        typeof detail === "string"
          ? detail
          : status === 409
            ? "This mobile number already has an account. Log in instead."
            : "Registration failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.post<EmployerResponse>("/auth/employer/otp/verify", {
        mobile_number: mobile,
        otp: otp.replace(/\D/g, ""),
      });
      declareSession("employer");
      localStorage.setItem("employer_user", JSON.stringify(res.data.employer));
      navigate("/employer/dashboard", { replace: true });
    } catch (err) {
      const detail = apiErrorDetail(err);
      setError(typeof detail === "string" ? detail : "Verification failed.");
    } finally {
      setBusy(false);
    }
  };

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — non-critical */
    }
  };

  return (
    <Screen title="Employer sign up" onBack={() => navigate("/employer/login")}>
      <div className="max-w-md mx-auto">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-blue-600 flex items-center justify-center shadow-lg shadow-brand-600/25 mb-4">
            <Building2 className="h-7 w-7 text-white" aria-hidden="true" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Create an employer account
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Post work, find labour-office accepted workers and call them directly.
          </p>
        </div>

        {phase === "form" && (
          <Card className="p-6">
            <form onSubmit={submitRegister} className="space-y-4">
              <div>
                <label
                  htmlFor="emp-name"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Owner / contact name
                </label>
                <input
                  id="emp-name"
                  className="input-field w-full"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  placeholder="Ravi Menon"
                  autoComplete="name"
                />
              </div>

              <div>
                <label
                  htmlFor="emp-business"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Business name{" "}
                  <span className="text-gray-400 font-normal">(shown on listings)</span>
                </label>
                <input
                  id="emp-business"
                  className="input-field w-full"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Ravi Constructions"
                  autoComplete="organization"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <input
                  className="input-field w-full"
                  value={businessCity}
                  onChange={(e) => setBusinessCity(e.target.value)}
                  placeholder="Area / city"
                  aria-label="Area or city"
                />
                <input
                  className="input-field w-full"
                  value={businessDistrict}
                  onChange={(e) => setBusinessDistrict(e.target.value)}
                  placeholder="District"
                  aria-label="District"
                />
                <input
                  className="input-field w-full"
                  value={businessState}
                  onChange={(e) => setBusinessState(e.target.value)}
                  placeholder="State"
                  aria-label="State"
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Your state and district route this account to the right labour office for review.
              </p>

              <div>
                <label
                  htmlFor="emp-mobile"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Mobile number
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    +91
                  </span>
                  <input
                    id="emp-mobile"
                    type="text"
                    inputMode="numeric"
                    className="input-field w-full pl-10"
                    value={mobileNumber}
                    onChange={(e) => setMobileNumber(digitsOnly(e.target.value))}
                    placeholder="9876543210"
                    required
                    maxLength={10}
                    autoComplete="tel"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="emp-password"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4"
                    aria-hidden="true"
                  />
                  <input
                    id="emp-password"
                    type="password"
                    className="input-field w-full pl-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="At least 6 characters"
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/30 p-3">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  ⚖️ A new employer account starts <b>pending</b>. You can browse and call workers
                  right away; posting listings and rating workers unlock once a labour office
                  accepts the account.
                </p>
              </div>

              {error && (
                <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 p-3">
                  <p className="text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" /> {error}
                  </p>
                </div>
              )}

              <Button type="submit" loading={busy} className="w-full">
                <User className="h-4 w-4" aria-hidden="true" /> Create employer account
              </Button>
            </form>
          </Card>
        )}

        {phase === "recovery" && (
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <AlertCircle
                className="h-5 w-5 text-amber-600 dark:text-amber-400"
                aria-hidden="true"
              />
              <h3 className="font-bold text-gray-900 dark:text-gray-100">Save your recovery key</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Shown only once. It recovers this account if you lose your phone or password.
            </p>
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl p-4 font-mono text-lg font-bold tracking-widest text-gray-900 dark:text-brand-300 select-all break-all">
              {recoveryKey}
            </div>
            <button
              type="button"
              onClick={copyKey}
              className="w-full text-sm font-medium text-brand-600 dark:text-brand-400 underline"
            >
              {copied ? "Copied ✓" : "Copy the key"}
            </button>
            <Button onClick={() => setPhase("otp")} className="w-full">
              I saved my recovery key — continue
            </Button>
          </Card>
        )}

        {phase === "otp" && (
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <Phone className="h-5 w-5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
              <h3 className="font-bold text-gray-900 dark:text-gray-100">Verify your mobile</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              OTP sent to{" "}
              <span className="font-medium text-gray-900 dark:text-gray-100">+91 {mobile}</span>.
            </p>
            <form onSubmit={verifyOtp} className="space-y-4">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="input-field w-full text-center text-lg tracking-[0.4em]"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="••••••"
                maxLength={6}
                required
                aria-label="6-digit OTP"
              />
              {error && (
                <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 p-3">
                  <p className="text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" /> {error}
                  </p>
                </div>
              )}
              <Button type="submit" loading={busy} disabled={otp.length !== 6} className="w-full">
                <CheckCircle className="h-4 w-4" aria-hidden="true" /> Verify and continue
              </Button>
            </form>
          </Card>
        )}

        <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-4">
          Already have an employer account?{" "}
          <button
            type="button"
            onClick={() => navigate("/employer/login")}
            className="text-brand-600 dark:text-brand-400 font-semibold"
          >
            Log in
          </button>
        </p>

        <p className="text-center text-xs text-gray-500 dark:text-gray-400 mt-2">
          OTP delivery in dev mode appears in the backend terminal.
        </p>
      </div>
    </Screen>
  );
}
