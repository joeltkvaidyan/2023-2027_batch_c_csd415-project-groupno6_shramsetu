import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Theme = "light" | "dark";
export type Contrast = "normal" | "high";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  contrast: Contrast;
  setContrast: (c: Contrast) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const STORAGE_KEY = "shramsetu.theme";
const CONTRAST_KEY = "shramsetu.contrast";

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* storage unavailable — fall through to the system preference */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialContrast(): Contrast {
  try {
    // A worker who has turned on high contrast in the OS gets it here too: that
    // setting exists because the default contrast is not enough for them.
    const stored = localStorage.getItem(CONTRAST_KEY);
    if (stored === "high" || stored === "normal") return stored;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia?.("(forced-colors: active)").matches ? "high" : "normal";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const [contrast, setContrastState] = useState<Contrast>(getInitialContrast);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* the choice still applies for this session */
    }
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (contrast === "high") root.classList.add("hc");
    else root.classList.remove("hc");
    try {
      localStorage.setItem(CONTRAST_KEY, contrast);
    } catch {
      /* the choice still applies for this session */
    }
  }, [contrast]);

  const setTheme = (t: Theme) => setThemeState(t);
  const toggleTheme = () => setThemeState((t) => (t === "dark" ? "light" : "dark"));

  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggleTheme,
        setTheme,
        contrast,
        setContrast: setContrastState,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
