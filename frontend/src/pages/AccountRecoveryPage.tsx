import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Smartphone, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { Screen } from "../components/Screen";
import { api, apiErrorDetail } from "../api/client";
import { useAuth } from "../store/AuthContext";
import type { Worker } from "../types";

/**
 * Account recovery — the "backup if he lost his phone no and password" flow.
 *
 * Two independent recoveries, both gated ONLY by the recovery key printed
 * once at registration (the phone is the thing being lost/replaced, so no
 * OTP can go to the OLD number):
 *  - Lost password: worker ID + recovery key → set a new password.
 *  - Lost phone (or both): worker ID + recovery key → OTP to the NEW
 *    number → account moves to that number and the session starts.
 */
type Mode = "password" | "mobile";

export default function AccountRecoveryPage() {
  const navigate = useNavigate();
  const { completeLogin } = useAuth();

  const [mode, setMode] = useState<Mode>("password");
  const [workerId, setWorkerId] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [newPasswordState, setNewPasswordState] = useState("");
  const [newMobile, setNewMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [mobileStep, setMobileStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  const reset = () => {
    setError(null);
    setDoneMsg(null);
    setMobileStep(1);
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post("/auth/worker/recover/password", {
        worker_id: workerId.trim(),
        recovery_key: recoveryKey.trim(),
        new_password: newPasswordState,
      });
      setDoneMsg(typeof res.data?.detail === "string" ? res.data.detail : "Password updated.");
    } catch (err) {
      setError(apiErrorDetail(err) || "Recovery failed. Check your worker ID and recovery key.");
    } finally {
      setBusy(false);
    }
  };

  const submitMobile = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mobileStep === 1) {
        await api.post("/auth/worker/recover/mobile", {
          worker_id: workerId.trim(),
          recovery_key: recoveryKey.trim(),
          new_mobile_number: newMobile.replace(/\D/g, ""),
        });
        setMobileStep(2);
      } else {
        const res = await api.post("/auth/worker/recover/mobile/confirm", {
          worker_id: workerId.trim(),
          recovery_key: recoveryKey.trim(),
          new_mobile_number: newMobile.replace(/\D/g, ""),
          otp: otp.replace(/\D/g, ""),
        });
        const data = res.data as { access_token: string; worker: Worker };
        completeLogin(data.worker);
        navigate("/worker/dashboard");
        return;
      }
    } catch (err) {
      setError(apiErrorDetail(err) || "Recovery failed. Check your worker ID and recovery key.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Recover account" onBack={true}>
      <div className="mb-6 animate-fade-up">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Lost your phone, your password, or both? Your recovery key — the SRK-… code printed once
          when you registered — proves who you are. No OTP can help here because the phone itself is
          the problem.
        </p>
      </div>

      <div className="flex bg-gray-100 dark:bg-gray-800 rounded-2xl p-1 mb-6">
        <button
          type="button"
          onClick={() => {
            setMode("password");
            reset();
          }}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 transition ${
            mode === "password"
              ? "bg-brand-600 text-white shadow-glow-brand"
              : "text-gray-600 dark:text-gray-300"
          }`}
        >
          <KeyRound className="h-4 w-4" aria-hidden="true" /> Forgot password
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("mobile");
            reset();
          }}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 transition ${
            mode === "mobile"
              ? "bg-brand-600 text-white shadow-glow-brand"
              : "text-gray-600 dark:text-gray-300"
          }`}
        >
          <Smartphone className="h-4 w-4" aria-hidden="true" /> Lost phone / change number
        </button>
      </div>

      {doneMsg && (
        <div
          className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 mb-4"
          role="status"
        >
          <p className="text-emerald-700 dark:text-emerald-300 text-sm flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" /> {doneMsg}
          </p>
          <button onClick={() => navigate("/worker/login")} className="btn-primary w-full mt-3">
            Go to login
          </button>
        </div>
      )}

      <form onSubmit={mode === "password" ? submitPassword : submitMobile} className="space-y-4">
        <div>
          <label
            htmlFor="rec-worker-id"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Worker ID
          </label>
          <input
            id="rec-worker-id"
            type="text"
            required
            className="input-field font-mono uppercase"
            value={workerId}
            onChange={(e) => setWorkerId(e.target.value)}
            placeholder="SS-100001"
          />
        </div>
        <div>
          <label
            htmlFor="rec-key"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Recovery key
          </label>
          <input
            id="rec-key"
            type="text"
            required
            autoComplete="off"
            className="input-field font-mono uppercase tracking-widest"
            value={recoveryKey}
            onChange={(e) => setRecoveryKey(e.target.value.toUpperCase())}
            placeholder="SRK-XXXX-XXXX-XXXX"
          />
        </div>

        {mode === "password" ? (
          <div>
            <label
              htmlFor="rec-pass"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              New password
            </label>
            <input
              id="rec-pass"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              className="input-field"
              value={newPasswordState}
              onChange={(e) => setNewPasswordState(e.target.value)}
              placeholder="At least 6 characters"
            />
          </div>
        ) : (
          <>
            <div>
              <label
                htmlFor="rec-new-mobile"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                New mobile number
              </label>
              <input
                id="rec-new-mobile"
                type="text"
                inputMode="numeric"
                required
                disabled={mobileStep === 2}
                className="input-field"
                value={newMobile}
                onChange={(e) => setNewMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="New 10-digit number"
              />
            </div>
            {mobileStep === 2 && (
              <div>
                <label
                  htmlFor="rec-otp"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  OTP sent to the new number
                </label>
                <input
                  id="rec-otp"
                  type="text"
                  inputMode="numeric"
                  required
                  className="input-field"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="6-digit code"
                />
              </div>
            )}
          </>
        )}

        {error && (
          <div
            className="bg-red-50 dark:bg-red-900/20 border border-red-200/70 dark:border-red-800 rounded-xl p-3"
            role="alert"
          >
            <p className="text-red-600 dark:text-red-400 text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" /> {error}
            </p>
          </div>
        )}

        <button type="submit" disabled={busy} className="btn-primary w-full mt-2 shadow-glow-brand">
          {busy ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              {mode === "mobile" && mobileStep === 2 ? "Verifying…" : "Working…"}
            </span>
          ) : mode === "password" ? (
            "Set new password"
          ) : mobileStep === 1 ? (
            "Send OTP to new number"
          ) : (
            "Confirm and log in"
          )}
        </button>
      </form>

      <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-6">
        Lost BOTH the password and the recovery key? Visit a Common Service Centre or labour office
        with your ID documents.
      </p>
    </Screen>
  );
}
