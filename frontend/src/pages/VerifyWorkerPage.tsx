import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { Screen } from "../components/Screen";
import { Card, Badge } from "../components/ui";
import { api, httpStatus } from "../api/client";

/**
 * Public result page behind a worker ID card's QR code.
 *
 * Inherited from the Tamil Nadu migrant-worker project, where a scanned QR
 * opened the worker's public profile page — and hardened, because that page
 * exposed the full record to anyone who could guess a code. Here the URL
 * carries a keyed token, and the server returns only name, trade, district and
 * state, and only while the registration is active and accepted.
 *
 * Deliberately reachable without signing in: the point of a scanned card is
 * that an employer, a police officer or a labour inspector can check it on the
 * spot.
 */
interface VerifyResult {
  valid: true;
  worker_id: string;
  full_name: string;
  occupation: string | null;
  district: string | null;
  state: string | null;
  registered_on: string | null;
  checked_at: string;
}

type State =
  | { kind: "checking" }
  | { kind: "valid"; result: VerifyResult }
  | { kind: "invalid"; malformed: boolean }
  | { kind: "error" };

export default function VerifyWorkerPage() {
  const { code = "" } = useParams();
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<State>({ kind: "checking" });

  useEffect(() => {
    let alive = true;
    setState({ kind: "checking" });
    api
      .get<VerifyResult>(`/public/verify/worker/${encodeURIComponent(code)}`)
      .then((res) => {
        if (alive) setState({ kind: "valid", result: res.data });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const status = httpStatus(err);
        // 400 = the code is not even shaped like a card code; 404 = the code is
        // well-formed but does not verify. Both are "not a valid card" to the
        // person holding the phone, but only the 400 can be described as
        // malformed rather than "unknown".
        setState(
          status === 400
            ? { kind: "invalid", malformed: true }
            : { kind: "invalid", malformed: false },
        );
      });
    return () => {
      alive = false;
    };
  }, [code]);

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    try {
      return date.toLocaleDateString(i18n.language, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return date.toISOString().slice(0, 10);
    }
  };

  return (
    <Screen title={t("verify.title", "Check a worker card")} onBack={true}>
      {state.kind === "checking" && (
        <p className="text-sm text-gray-500">{t("verify.checking", "Checking this card...")}</p>
      )}

      {state.kind === "valid" && (
        <Card className="border-green-200 dark:border-green-900">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-green-600" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-semibold text-green-800 dark:text-green-300">
                {t("verify.validTitle", "This is a verified worker card")}
              </p>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                {t(
                  "verify.validBody",
                  "ShramSetu issued this card and a labour office accepted the registration.",
                )}
              </p>
            </div>
          </div>

          <dl className="mt-4 space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
            <div className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                {t("verify.workerId", "Worker ID")}
              </dt>
              <dd className="font-mono text-sm font-semibold break-words text-gray-900 dark:text-gray-100">
                {state.result.worker_id}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                {t("idCard.name", "Name")}
              </dt>
              <dd className="text-sm break-words text-gray-900 dark:text-gray-100">
                {state.result.full_name}
              </dd>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="min-w-0">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  {t("idCard.occupation", "Work")}
                </dt>
                <dd className="text-sm break-words text-gray-900 dark:text-gray-100">
                  {state.result.occupation || t("common.notProvided", "Not provided")}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  {t("idCard.place", "Place")}
                </dt>
                <dd className="text-sm break-words text-gray-900 dark:text-gray-100">
                  {[state.result.district, state.result.state].filter(Boolean).join(", ") ||
                    t("common.notProvided", "Not provided")}
                </dd>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  {t("idCard.registeredOn", "Registered on")}
                </dt>
                <dd className="text-sm text-gray-900 dark:text-gray-100">
                  {formatDate(state.result.registered_on)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  {t("verify.checkedAt", "Checked")}
                </dt>
                <dd className="text-sm text-gray-900 dark:text-gray-100">
                  {formatDate(state.result.checked_at)}
                </dd>
              </div>
            </div>
          </dl>

          <p className="mt-3 border-t border-gray-100 pt-2 text-[10px] leading-relaxed text-gray-500 dark:border-gray-800 dark:text-gray-400">
            {t(
              "verify.notice",
              "This confirms the registration and its acceptance. It is not a background check, and it says nothing about a specific employer or wage.",
            )}
          </p>
        </Card>
      )}

      {state.kind === "invalid" && (
        <Card className="border-red-200 dark:border-red-900">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-red-600" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-semibold text-red-800 dark:text-red-300">
                {state.malformed
                  ? t("verify.malformedTitle", "This is not a ShramSetu card code")
                  : t("verify.invalidTitle", "This card could not be verified")}
              </p>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                {state.malformed
                  ? t(
                      "verify.malformedBody",
                      "The link looks incomplete. Scan the QR code on the card again instead of typing it.",
                    )
                  : t(
                      "verify.invalidBody",
                      "No accepted, active registration matches this card. It may be a copy, an old card, or a registration that was rejected.",
                    )}
              </p>
              <div className="mt-3">
                <Badge tone="danger">{t("verify.invalidBadge", "Not verified")}</Badge>
              </div>
            </div>
          </div>
        </Card>
      )}

      {state.kind === "error" && (
        <Card className="border-red-200 dark:border-red-900">
          <p className="text-sm text-red-700 dark:text-red-300">
            {t(
              "verify.errorBody",
              "Could not reach the server. Check your connection and try again.",
            )}
          </p>
        </Card>
      )}
    </Screen>
  );
}
