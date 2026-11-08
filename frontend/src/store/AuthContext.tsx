import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { api, httpStatus } from "../api/client";
import { declareSession, forgetSession, onSessionExpired, signOut } from "../api/session";
import { clearAllCachedDocuments } from "../services/documentCache";
import { lockWallet } from "../services/documentSecurity";
import type { Worker } from "../types";

/**
 * Ending a session must also end everything the wallet was holding: the PIN in
 * memory, the derived cache key and the encrypted documents themselves. Failed
 * cache cleanup is not worth blocking a logout on, hence the catch.
 */
function purgeWallet() {
  lockWallet();
  void clearAllCachedDocuments().catch(() => {
    /* no IndexedDB (private mode) — nothing was cached */
  });
}

interface AuthContextValue {
  worker: Worker | null;
  loading: boolean;
  bootError: boolean;
  completeLogin: (worker: Worker) => void;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [worker, setWorker] = useState<Worker | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState(false);

  // There is no token to check before asking: the session lives in an httpOnly
  // cookie, so the only way to know whether one exists is to try. A signed-out
  // visitor gets `no_token`, which is not an error worth surfacing.
  const refreshMe = useCallback(async () => {
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
        forgetSession();
        purgeWallet();
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

  /** A login response has already set the cookies; this records the identity. */
  const completeLogin = (w: Worker) => {
    declareSession("worker");
    setWorker(w);
  };

  const logout = async () => {
    await signOut();
    purgeWallet();
    setWorker(null);
  };

  // A refresh that fails (expired or revoked refresh token) ends the session
  // without the page having to poll for it.
  useEffect(() => {
    return onSessionExpired(() => setWorker(null));
  }, []);

  return (
    <AuthContext.Provider value={{ worker, loading, bootError, completeLogin, logout, refreshMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
