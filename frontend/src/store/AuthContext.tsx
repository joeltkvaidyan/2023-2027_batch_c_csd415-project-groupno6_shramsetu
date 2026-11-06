import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { api, clearToken, getToken, setToken, httpStatus } from "../api/client";
import type { Worker } from "../types";

interface AuthContextValue {
  worker: Worker | null;
  loading: boolean;
  bootError: boolean;
  loginWithToken: (token: string, worker: Worker) => void;
  logout: () => void;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [worker, setWorker] = useState<Worker | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState(false);

  const refreshMe = useCallback(async () => {
    if (!getToken()) {
      setWorker(null);
      setBootError(false);
      setLoading(false);
      return;
    }
    try {
      const res = await api.get<Worker>("/auth/worker/me");
      setWorker(res.data);
      setBootError(false);
    } catch (err: unknown) {
      // Only treat this as "not logged in" for an actual auth failure.
      // A network hiccup (offline, timeout, 5xx) shouldn't silently log
      // the worker out and bounce them to the login screen — surface it
      // as a retryable error instead (see ProtectedRoute).
      if (httpStatus(err) === 401) {
        clearToken();
        setWorker(null);
        setBootError(false);
      } else {
        setBootError(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  const loginWithToken = (token: string, w: Worker) => {
    setToken(token);
    setWorker(w);
  };

  const logout = () => {
    clearToken();
    setWorker(null);
  };

  return (
    <AuthContext.Provider value={{ worker, loading, bootError, loginWithToken, logout, refreshMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
