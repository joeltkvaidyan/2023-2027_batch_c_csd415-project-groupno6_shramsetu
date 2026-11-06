import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "../i18n/languages";
import { setStoredLanguage } from "../i18n/index";

export default function LanguageSelectPage() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  // Default to English if no language is selected yet
  const [selected, setSelected] = useState(() => {
    const stored = localStorage.getItem("shramsetu.language");
    return stored || "en";
  });

  const handleContinue = () => {
    i18n.changeLanguage(selected);
    setStoredLanguage(selected);
    localStorage.setItem("shramsetu.onboarded_language", "true");
    navigate("/roles");
  };

  // Language selection screen always displays in English
  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-700 via-brand-800 to-brand-950 flex flex-col justify-center px-6 py-10 relative overflow-hidden">
      {/* Animated aurora orbs */}
      <div
        className="orb w-[26rem] h-[26rem] -top-32 -right-24 bg-emerald-400/20 blur-3xl animate-aurora-shift"
        aria-hidden="true"
      />
      <div
        className="orb w-80 h-80 bottom-[-6rem] -left-20 bg-teal-300/15 blur-3xl animate-aurora-shift [animation-delay:-7s]"
        aria-hidden="true"
      />
      <div
        className="orb w-40 h-40 top-1/3 left-1/4 bg-emerald-300/10 blur-2xl animate-float"
        aria-hidden="true"
      />

      <div className="text-center mb-10 relative animate-fade-up">
        <div className="mx-auto mb-5 w-20 h-20 rounded-3xl bg-white/10 backdrop-blur flex items-center justify-center text-4xl ring-1 ring-white/20 shadow-glow-brand animate-float">
          🤝
        </div>
        <h1 className="text-4xl font-bold text-white tracking-tight">ShramSetu</h1>
        <p className="text-emerald-100/80 mt-2 text-base">Your welfare journey, in your language</p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-8 relative">
        {SUPPORTED_LANGUAGES.map((lang, i) => (
          <button
            key={lang.code}
            onClick={() => setSelected(lang.code)}
            style={{ animationDelay: `${i * 55}ms` }}
            className={`rounded-2xl px-4 py-5 text-left transition-all duration-200 active:scale-[0.96] animate-fade-up ${
              selected === lang.code
                ? "bg-white text-brand-900 shadow-glow-brand-lg ring-2 ring-white scale-[1.02]"
                : "bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm ring-1 ring-white/10"
            }`}
          >
            <div className="text-xl font-semibold">{lang.nativeName}</div>
            <div className={`text-sm ${selected === lang.code ? "text-brand-700" : "opacity-75"}`}>
              {lang.englishName}
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={handleContinue}
        className="btn-primary bg-white !text-brand-800 hover:!bg-emerald-50 shadow-glow-brand-lg relative animate-fade-up [animation-delay:400ms]"
      >
        Continue →
      </button>
      <p className="text-center text-emerald-100/60 text-sm mt-4 relative animate-fade-in [animation-delay:600ms]">
        You can change this anytime in Settings
      </p>
    </div>
  );
}
