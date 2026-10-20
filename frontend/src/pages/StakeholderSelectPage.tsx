import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Screen } from "../components/Screen";

const ROLES = [
  { key: "worker", icon: "👷", gradient: "from-amber-400 to-orange-500", path: "/worker/login" },
  { key: "employer", icon: "🏢", gradient: "from-sky-400 to-blue-600", path: "/employer/login" },
  { key: "government", icon: "🏛️", gradient: "from-blue-500 to-indigo-600", path: "/government/dashboard" },
  { key: "insurance", icon: "🛡️", gradient: "from-emerald-400 to-teal-600", path: "/roles/insurance" },
] as const;

export default function StakeholderSelectPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Screen onBack={() => navigate("/")}>
      <div className="text-center mb-8 animate-fade-up">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("role.select")}
        </h1>
        <p className="text-sm text-gray-400 mt-1">Choose how you want to continue</p>
      </div>
      <div className="grid grid-cols-1 gap-4">
        {ROLES.map((role, i) => (
          <button
            key={role.key}
            onClick={() => navigate(role.path)}
            style={{ animationDelay: `${i * 70}ms` }}
            className="card flex items-center gap-4 py-5 active:scale-[0.98] transition-all duration-200 text-left
              hover:shadow-card-hover hover:-translate-y-0.5 hover:border-brand-200 dark:hover:border-brand-800 animate-fade-up group"
          >
            <span
              className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${role.gradient} flex items-center justify-center
                text-2xl shadow-md transition-transform duration-200 group-hover:scale-110 group-hover:rotate-3`}
            >
              {role.icon}
            </span>
            <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t(`role.${role.key}`)}
            </span>
            <span className="ml-auto text-gray-300 dark:text-gray-600 text-xl transition-transform duration-200 group-hover:translate-x-1 group-hover:text-brand-500">
              ›
            </span>
          </button>
        ))}
      </div>

      {/* Public directory for “common people” — no account needed. */}
      <div className="mt-8 animate-fade-up">
        <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2">Not on the platform?</p>
        <button
          onClick={() => navigate("/find-workers")}
          className="card flex items-center gap-4 py-4 w-full active:scale-[0.98] transition-all duration-200 text-left hover:shadow-card-hover hover:-translate-y-0.5 hover:border-brand-200 dark:hover:border-brand-800 group"
        >
          <span className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-600 flex items-center justify-center text-2xl shadow-md transition-transform duration-200 group-hover:scale-110 group-hover:rotate-3">
            🔎
          </span>
          <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">Find a worker near you</span>
          <span className="ml-auto text-gray-300 dark:text-gray-600 text-xl transition-transform duration-200 group-hover:translate-x-1 group-hover:text-brand-500">›</span>
        </button>
        <p className="text-xs text-gray-400 mt-2 text-center">
          The public directory shows government-approved workers' names,
          trades and places — approach them directly for work. No login needed.
        </p>
      </div>
    </Screen>
  );
}
