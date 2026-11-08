import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import {
  declareSession,
  forgetSession,
  onSessionExpired,
  resolveSession,
  signOut,
} from "../api/session";
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
  refreshMe: (force?: boolean) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [worker, setWorker] = useState<Worker | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState(false);

  // There is no token to check before asking: the session lives in an httpOnly
  // cookie, so the only way to know whether one exists is to try. The probe
  // (`GET /auth/session`) is shared with RoleRoute, so a page load asks the
  // server once and both the guard and this context read the same answer — the
  // worker profile comes back in that response rather than in a second call.
  const refreshMe = useCallback(async (force = false) => {
    try {
      const session = await resolveSession(force);
      if (session?.role === "worker" && session.worker) {
        setWorker(session.worker);
        setBootError(false);
      } else {
        // Signed out, or signed in as another role: this tab holds no worker.
        forgetSession();
        purgeWallet();
        setWorker(null);
        setBootError(false);
      }
    } catch {
      // A network hiccup (offline, timeout, 5xx) must not silently log the
      // worker out and bounce them to the login screen — surface it as a
      // retryable error instead (see RoleRoute).
      setBootError(true);
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
