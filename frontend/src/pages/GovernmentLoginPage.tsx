import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { govLogin } from "../api/governmentClient";
import { apiErrorMessage } from "../api/client";
import { declareSession } from "../api/session";

export default function GovernmentLoginPage() {
  const navigate = useNavigate();
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await govLogin(employeeId, password);
      declareSession("government");
      localStorage.setItem("gov_user", JSON.stringify(res.government));
      navigate("/government/dashboard");
    } catch (err) {
      setError(apiErrorMessage(err, "Invalid credentials"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center px-4 relative overflow-hidden">
      {/* Backdrop orbs */}
      <div
        className="orb w-[28rem] h-[28rem] -top-40 -right-28 bg-blue-600/20 blur-3xl animate-aurora-shift"
        aria-hidden="true"
      />
      <div
        className="orb w-96 h-96 -bottom-32 -left-24 bg-indigo-500/15 blur-3xl animate-aurora-shift [animation-delay:-7s]"
        aria-hidden="true"
      />

      <div className="w-full max-w-md relative">
        <div className="text-center mb-8 animate-fade-up">
          <div className="w-20 h-20 mx-auto bg-gradient-to-br from-blue-500 to-indigo-600 rounded-3xl flex items-center justify-center shadow-glow-brand-lg mb-4 animate-float ring-1 ring-white/20">
            <span className="text-4xl">🛡️</span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">ShramSetu</h1>
          <p className="text-blue-300 mt-1">Government Official Portal</p>
          <p className="text-slate-500 text-sm mt-1 flex items-center justify-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-soft inline-block" />
            Secure Access Only
          </p>
        </div>

        <div className="bg-white/[0.07] backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-white/10 animate-fade-up [animation-delay:120ms]">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div
                className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-300 text-sm animate-scale-in"
                role="alert"
              >
                ⚠️ {error}
              </div>
            )}

            <div>
              <label
                htmlFor="gov-employee-id"
                className="block text-sm font-medium text-slate-300 mb-2"
              >
                Employee ID
              </label>
              <input
                id="gov-employee-id"
                type="text"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                placeholder="Employee ID"
                required
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/80 focus:border-transparent transition focus:bg-white/[0.14]"
              />
            </div>

            <div>
              <label
                htmlFor="gov-password"
                className="block text-sm font-medium text-slate-300 mb-2"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="gov-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/80 focus:border-transparent transition pr-12 focus:bg-white/[0.14]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-white transition min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                  {showPassword ? "🙈" : "👁️"}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !employeeId || !password}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold py-3 rounded-xl shadow-lg shadow-blue-600/25 hover:shadow-xl hover:shadow-blue-600/30 hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              {loading ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </div>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-white/10">
            <p className="text-slate-500 text-xs text-center">
              Admin accounts are provisioned via BOOTSTRAP_ADMIN_EMPLOYEE_ID /
              BOOTSTRAP_ADMIN_PASSWORD on the server (see .env.example), or by a superadmin through
              /auth/government/register.
            </p>
          </div>
        </div>

        <p className="text-center text-slate-600 text-xs mt-6 animate-fade-in [animation-delay:300ms]">
          Authorized personnel only. All access is logged and monitored.
        </p>
      </div>
    </div>
  );
}
