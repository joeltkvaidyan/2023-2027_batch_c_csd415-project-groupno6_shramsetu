/**
 * The single route guard.
 *
 * There used to be four: `ProtectedRoute` for workers, a `GovernmentRoute` that
 * did its own refresh dance, and employer/citizen pages that redirected
 * themselves with an `if` inside the component. They disagreed — one asked
 * `/auth/worker/me`, another read a localStorage flag, another trusted a token
 * it could read. A user could be signed in and still bounce, or be signed out
 * and see a page's skeleton of real data for a frame.
 *
 * This component asks one question per page load — `GET /auth/session`, cached
 * in `api/session` — and compares the server's answer to the role the route
 * requires. Authorization is never inferred from stored state: a role is only
 * ever the server's.
 *
 * States, and why each one is what it is:
 *   checking → skeleton. No content, because the verdict is unknown.
 *   denied   → redirect to that role's login. A worker who opens a government
 *              URL goes to the worker's own entry point, not a government form
 *              they cannot use.
 *   error    → retry, not a logout. A network blip must never sign anyone out.
 *   allowed  → the page.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { onSessionExpired, resolveRole, type SessionRole } from "../api/session";
import { useAuth } from "../store/AuthContext";
import { RouteSkeleton } from "./RouteSkeleton";

const LOGIN_PATH: Record<SessionRole, string> = {
  worker: "/worker/login",
  employer: "/employer/login",
  citizen: "/citizen/login",
  government: "/government/login",
};

type Gate = "checking" | "allowed" | "denied" | "error";

export function RoleRoute({ role, children }: { role: SessionRole; children: ReactNode }) {
  const { t } = useTranslation();
  const { worker, loading, bootError, refreshMe } = useAuth();
  const [gate, setGate] = useState<Gate>("checking");

  const check = useCallback(
    async (active: () => boolean, force = false) => {
      setGate("checking");
      try {
        const actual = await resolveRole(force);
        if (!active()) return;
        setGate(actual === role ? "allowed" : "denied");
      } catch {
        if (active()) setGate("error");
      }
    },
    [role],
  );

  // Worker routes reuse the profile AuthContext already booted: that request is
  // the worker's session check, so probing again would be a second round trip
  // for the same answer.
  useEffect(() => {
    if (role === "worker") return;
    let active = true;
    void check(() => active);
    // A refresh that fails later (session revoked, token reused) must drop the
    // page too, not only the first render's verdict.
    const unsubscribe = onSessionExpired(() => {
      if (active) setGate("denied");
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [check, role]);

  if (role === "worker") {
    if (loading) return <RouteSkeleton />;
    if (worker) return <>{children}</>;
    if (bootError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-gray-50 dark:bg-gray-900 px-6 text-center">
          <p className="text-gray-500 text-sm">{t("common.error")}</p>
          <button
            onClick={() => refreshMe()}
            className="text-sm font-semibold text-brand-600 dark:text-brand-400 underline"
          >
            {t("common.retry")}
          </button>
        </div>
      );
    }
    return <Navigate to={LOGIN_PATH[role]} replace />;
  }

  if (gate === "checking") return <RouteSkeleton />;
  if (gate === "error") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-gray-50 dark:bg-gray-900 px-6 text-center">
        <p className="text-gray-500 text-sm">{t("common.error")}</p>
        <button
          onClick={() => void check(() => true, true)}
          className="text-sm font-semibold text-brand-600 dark:text-brand-400 underline"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }
  if (gate === "denied") return <Navigate to={LOGIN_PATH[role]} replace />;
  return <>{children}</>;
}
