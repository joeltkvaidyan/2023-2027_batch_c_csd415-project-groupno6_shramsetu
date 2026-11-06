import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Screen } from "../components/Screen";
import { BottomNav } from "../components/BottomNav";
import { SUPPORTED_LANGUAGES } from "../i18n/languages";
import { setStoredLanguage } from "../i18n/index";
import { useTheme } from "../store/ThemeContext";
import { useAuth } from "../store/AuthContext";
import { Avatar } from "../components/ui";
import { Sun, Moon, LogOut } from "lucide-react";
import { api } from "../api/client";

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { worker, logout } = useAuth();
  const navigate = useNavigate();

  const handleLanguageChange = async (code: string) => {
    i18n.changeLanguage(code);
    setStoredLanguage(code);
    try {
      await api.put("/settings/language", { language: code });
    } catch {
      /* non-fatal: UI already switched locally */
    }
  };

  const handleLogout = () => {
    // Clear local auth state immediately — don't let API failure block logout
    logout();
    // Try server-side logout in background (non-blocking, fire-and-forget)
    api.post("/auth/worker/logout").catch(() => {});
    navigate("/");
  };

  return (
    <>
      <Screen title={t("settings.title")}>
        {worker && (
          <div className="card flex items-center gap-4 mb-6 animate-fade-up">
            <Avatar name={worker.full_name} size="lg" />
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                {worker.full_name}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{worker.mobile_number}</p>
              <p className="text-xs font-mono text-brand-600 dark:text-brand-400 mt-0.5">
                {worker.worker_id}
              </p>
            </div>
          </div>
        )}

        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">
          {t("settings.language")}
        </h2>
        <div className="grid grid-cols-2 gap-2 mb-6">
          {SUPPORTED_LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleLanguageChange(lang.code)}
              className={`rounded-xl px-3 py-3 text-sm text-left transition-all duration-150 ${
                i18n.language === lang.code
                  ? "bg-brand-600 text-white font-semibold shadow-glow-brand"
                  : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700"
              }`}
            >
              {lang.nativeName}
            </button>
          ))}
        </div>

        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">
          {t("settings.theme")}
        </h2>
        <div className="grid grid-cols-2 gap-2 mb-8">
          <button
            onClick={() => setTheme("light")}
            className={`rounded-xl px-3 py-3 text-sm font-medium flex items-center justify-center gap-1.5 transition-all duration-150 ${
              theme === "light"
                ? "bg-brand-600 text-white shadow-glow-brand"
                : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700"
            }`}
          >
            <Sun className="h-4 w-4" aria-hidden="true" /> {t("settings.light")}
          </button>
          <button
            onClick={() => setTheme("dark")}
            className={`rounded-xl px-3 py-3 text-sm font-medium flex items-center justify-center gap-1.5 transition-all duration-150 ${
              theme === "dark"
                ? "bg-brand-600 text-white shadow-glow-brand"
                : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700"
            }`}
          >
            <Moon className="h-4 w-4" aria-hidden="true" /> {t("settings.dark")}
          </button>
        </div>

        <button
          onClick={handleLogout}
          className="w-full rounded-2xl border-2 border-red-200 dark:border-red-900 px-6 py-3.5 text-base font-semibold text-red-600 dark:text-red-400
            flex items-center justify-center gap-2 transition-all duration-150 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-400 dark:hover:border-red-700 active:scale-[0.98]
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" /> {t("settings.logout")}
        </button>
      </Screen>
      <BottomNav />
    </>
  );
}
