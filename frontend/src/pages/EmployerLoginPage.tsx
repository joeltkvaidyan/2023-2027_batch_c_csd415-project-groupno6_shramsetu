import { FormEvent, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, CheckCircle, Lock, Loader2, Phone, User, Users } from "lucide-react";
import { Screen } from "../components/Screen";
import { api, setEmployerToken } from "../api/client";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import type { Worker } from "../types";

type Mode = "register" | "password" | "otp" | "recovery";

interface EmployerResponse {
  access_token: string;
  employer: Worker;
}

export default function EmployerLoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("register");
  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessState, setBusinessState] = useState("");
  const [businessDistrict, setBusinessDistrict] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [pendingMobile, setPendingMobile] = useState<string | null>(null);
  const [recoveryCopied, setRecoveryCopied] = useState(false);
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);

  const finishLogin = useCallback((data: EmployerResponse) => {
    setEmployerToken(data.access_token);
    localStorage.setItem("employer_user", JSON.stringify(data.employer));
    navigate("/employer/dashboard", { replace: true });
  }, [navigate]);

  const resetFlow = useCallback((next: Mode) => {
    setMode(next);
    setError(null);
    setOtpSent(false);
    setOtp("");
  }, []);

  const digitsOnly = (v: string) => v.replace(/\D/g, "").slice(0, 10);

  const submitRegister = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ recovery_key: string }>("/auth/employer/register", {
        full_name: fullName.trim(),
        mobile_number: digitsOnly(mobileNumber),
        password,
        business_name: businessName.trim() || undefined,
        business_state: businessState.trim() || undefined,
        business_district: businessDistrict.trim() || undefined,
      });
      setRecoveryKey(res.data.recovery_key);
      setPendingMobile(digitsOnly(mobileNumber));
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
        mobile_number: digitsOnly(mobileNumber),
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
        mobile_number: digitsOnly(mobileNumber),
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
    if (recoveryKey && pendingMobile && mode === "register") {
      return void submitOtp("/auth/employer/otp/verify");
    }
    if (mode === "register") return void submitRegister();
    if (mode === "password") return void submitPassword();
    if (!otpSent) {
      setBusy(true);
      api
        .post("/auth/employer/login/otp/request", { mobile_number: digitsOnly(mobileNumber) })
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

  const modeConfig: Record<Mode, { label: string; icon: React.ElementType }> = {
    register: { label: "Create account", icon: User },
    password: { label: "Password login", icon: Lock },
    otp: { label: "OTP login", icon: Phone },
    recovery: { label: "Recover account", icon: User },
  };

  return (
    <Screen title="Employer" onBack={true}>
      <div className="max-w-md mx-auto">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-blue-600 flex items-center justify-center shadow-lg shadow-brand-600/25 mb-4">
            <Users className="h-7 w-7 text-white" aria-hidden="true" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">ShramSetu Employer</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Hire trusted, government-verified workers</p>
        </div>

        <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 mb-6">
          {(["register", "password", "otp"] as Mode[]).map((m) => {
            const config = modeConfig[m];
            const Icon = config.icon;
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => resetFlow(m)}
                className={`flex-1 py-2.5 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 ${
                  active ? "bg-white shadow-sm text-brand-700 dark:text-brand-400" : "text-gray-600 dark:text-gray-300"
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {config.label}
              </button>
            );
          })}
        </div>

        {recoveryKey && pendingMobile && !recoveryConfirmed && (
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <h3 className="font-bold text-gray-900 dark:text-gray-100">Back up your account</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Your recovery key is shown only once. Write it down — it recovers this account if you lose your phone or password.
            </p>
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl p-4 font-mono text-lg font-bold tracking-widest text-gray-900 dark:text-brand-300 select-all break-all">
              {recoveryKey}
            </div>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(recoveryKey);
                  setRecoveryCopied(true);
                  setTimeout(() => setRecoveryCopied(false), 1600);
                } catch {
                }
              }}
              className="w-full text-sm font-medium text-brand-600 dark:text-brand-400 underline transition"
            >
              {recoveryCopied ? "Copied ✓" : "Copy the key"}
            </button>
            <Button onClick={() => setRecoveryConfirmed(true)} className="w-full">
              I saved my recovery key
            </Button>
          </Card>
        )}

        {recoveryKey && pendingMobile && recoveryConfirmed && (
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <Phone className="h-5 w-5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
              <h3 className="font-bold text-gray-900 dark:text-gray-100">Verify your mobile</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              OTP sent to <span className="font-medium text-gray-900 dark:text-gray-100">+91 {pendingMobile}</span>
            </p>
            <input
              type="text"
              inputMode="numeric"
              className="input-field w-full"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="6-digit code"
              maxLength={6}
            />
            {error && (
              <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 p-3">
                <p className="text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" /> {error}
                </p>
              </div>
            )}
            <Button onClick={handleSubmit} loading={busy} disabled={!otp || otp.length !== 6} className="w-full">
              {busy ? "Verifying…" : "Verify and continue"}
            </Button>
          </Card>
        )}

        {!recoveryKey && (
          <Card className="p-6 space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "register" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Business / owner name
                  </label>
                  <input
                    className="input-field w-full"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    placeholder="Ravi Constructions"
                  />
                </div>
              )}

              {mode === "register" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Business name (as it will appear on listings)
                    </label>
                    <input
                      className="input-field w-full"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="Ravi Constructions Pvt Ltd"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      State
                    </label>
                    <input
                      className="input-field w-full"
                      value={businessState}
                      onChange={(e) => setBusinessState(e.target.value)}
                      placeholder="Kerala"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      District
                    </label>
                    <input
                      className="input-field w-full"
                      value={businessDistrict}
                      onChange={(e) => setBusinessDistrict(e.target.value)}
                      placeholder="Ernakulam"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Mobile number
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">+91</span>
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
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4" aria-hidden="true" />
                    <input
                      type="password"
                      className="input-field w-full pl-10"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      placeholder={mode === "register" ? "At least 6 characters" : "Your password"}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {mode === "register" ? "Create a strong password" : "Enter your password"}
                  </p>
                  {mode === "register" && (
                    <div className="mt-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/30 p-3">
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        ⚖️ Labour-office review: a new employer account starts <b>pending</b>. Only after your
                        State/District Labour Office accepts it can you post job listings publicly and rate workers.
                        Adding your state and district routes your account to the right office.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {mode === "otp" && otpSent && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    OTP sent to your mobile
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4" aria-hidden="true" />
                    <input
                      type="text"
                      inputMode="numeric"
                      className="input-field w-full pl-10"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="6-digit code"
                      required
                      maxLength={6}
                    />
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 p-3">
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
                ) : mode === "register" ? (
                  <span className="flex items-center justify-center gap-2">
                    <User className="h-4 w-4" aria-hidden="true" /> Create employer account
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
        )}

        <p className="text-center text-xs text-gray-500 dark:text-gray-400 mt-4">
          OTP delivery in dev mode appears in the backend terminal.
        </p>
      </div>
    </Screen>
  );
}
