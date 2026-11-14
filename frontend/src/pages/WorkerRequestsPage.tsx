import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Handshake, MapPin, MessageSquare, Phone, Star } from "lucide-react";
import { Screen } from "../components/Screen";
import { BottomNav } from "../components/BottomNav";
import { Card, Badge, SkeletonList } from "../components/ui";
import { Button } from "../components/ui/Button";
import { api, apiErrorMessage, httpStatus, apiErrorCode } from "../api/client";

/**
 * House offers near me — citizens' service requests, scored with the same
 * explainable logic as jobs ("why matched" chips). A worker BROWSES requests
 * anonymously: the citizen's phone number appears only AFTER this worker
 * taps accept, at which point both sides see each other's number. Pending
 * workers see the list but cannot accept (gov-gated server-side).
 */
interface NearbyRequest {
  id: string;
  occupation: string;
  description: string;
  area_village: string | null;
  district: string | null;
  state: string | null;
  preferred_time: string | null;
  citizen_name: string;
  status: string;
  created_at: string;
  match: { score: number; level: "strong" | "good" | "possible"; reasons: string[] };
}

interface AcceptedRequest {
  id: string;
  occupation: string;
  description: string;
  area_village: string | null;
  district: string | null;
  state: string | null;
  preferred_time: string | null;
  status: "accepted" | "done";
  created_at: string;
  accepted_at: string | null;
  citizen: { name: string; phone: string };
}

const LEVEL_TONE = { strong: "success", good: "info", possible: "neutral" } as const;

export default function WorkerRequestsPage() {
  const { t } = useTranslation();
  const [nearby, setNearby] = useState<NearbyRequest[] | null>(null);
  const [accepted, setAccepted] = useState<AcceptedRequest[] | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [gate, setGate] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const [nearbyRes, acceptedRes] = await Promise.all([
        api.get("/requests/nearby"),
        api.get("/requests/accepted"),
      ]);
      setNearby(nearbyRes.data.requests ?? []);
      setAccepted(acceptedRes.data.requests ?? []);
      setGate(false);
    } catch (err) {
      setNearby([]);
      const msg = apiErrorMessage(err, t("common.error"));
      setError(msg);
      if (httpStatus(err) === 403 && apiErrorCode(err) === "gov_approval_pending") {
        setGate(true);
      }
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async (r: NearbyRequest) => {
    setBusyId(r.id);
    setError("");
    try {
      const res = await api.post<AcceptedRequest>(`/requests/${r.id}/accept`);
      setAccepted((prev) => [res.data, ...(prev ?? [])]);
      setNote(
        t(
          "requests.acceptedReveal",
          "Accepted! The requester's number is now visible below, and they can see yours. Call them to confirm the work.",
        ),
      );
      void load();
    } catch (err) {
      setError(apiErrorMessage(err, t("common.error")));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen title={t("requests.title", "House requests")} onBack={true}>
      <div className="p-4 pb-40 space-y-6 max-w-lg mx-auto">
        {error && (
          <Card className="border-red-100 dark:border-red-900/30 bg-red-50 dark:bg-red-900/20 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          </Card>
        )}
        {note && (
          <Card className="border-emerald-100 dark:border-emerald-900/30 bg-emerald-50 dark:bg-emerald-900/20 p-4">
            <div className="flex items-start gap-3">
              <Handshake className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
              <p className="text-sm text-emerald-700 dark:text-emerald-300">{note}</p>
            </div>
          </Card>
        )}

        <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2">
          {t(
            "requests.intro",
            "Households near you need your trade. Browsing is anonymous — your number is shared only if you accept.",
          )}
        </p>

        {gate && (
          <Card className="border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 p-4">
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {t(
                "requests.gatePending",
                "Your registration is pending government acceptance, so you can read these offers but not accept them. Once a labour office accepts you, this unlocks.",
              )}
            </p>
          </Card>
        )}

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              {t("requests.nearbyTitle", "Open requests near you")}
            </h2>
          </div>
          {nearby === null ? (
            <SkeletonList rows={2} />
          ) : nearby.length === 0 ? (
            <Card className="text-center py-6">
              <p className="text-sm text-gray-400">
                {t(
                  "requests.nearbyEmpty",
                  "No open house requests near you right now. Check back later.",
                )}
              </p>
            </Card>
          ) : (
            nearby.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <h3 className="font-bold text-gray-900 dark:text-gray-100 capitalize">
                      {r.occupation.replace(/_/g, " ")}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5">
                      <MapPin className="h-3 w-3" aria-hidden="true" />
                      {r.area_village ? `${r.area_village}, ` : ""}
                      {r.district || "—"}
                      {r.preferred_time ? ` • ${r.preferred_time}` : ""}
                    </p>
                  </div>
                  <Badge tone={LEVEL_TONE[r.match.level]}>
                    {t("requests.fit", "fit")} {r.match.score}
                  </Badge>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-200">{r.description}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {r.match.reasons.map((reason) => (
                    <Badge key={reason} tone="neutral">
                      {t(`jobs.reasons.${reason}`, reason.replace(/_/g, " "))}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  {t("requests.askedBy", "From")} {r.citizen_name}
                </p>
                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex justify-end">
                  <Button
                    size="sm"
                    loading={busyId === r.id}
                    disabled={gate}
                    onClick={() => void accept(r)}
                  >
                    {t("requests.accept", "Accept & reveal numbers")}
                  </Button>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  {t(
                    "requests.acceptHint",
                    "Accepting opens BOTH sides' numbers to each other. Expect a call or SMS from the household.",
                  )}
                </p>
              </Card>
            ))
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              {t("requests.acceptedTitle", "My accepted requests")}
            </h2>
          </div>
          {accepted === null ? null : accepted.length === 0 ? (
            <p className="text-sm text-gray-400">
              {t("requests.acceptedEmpty", "Nothing accepted yet.")}
            </p>
          ) : (
            accepted.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100 capitalize">
                        {r.occupation.replace(/_/g, " ")}
                      </h3>
                      <Badge tone={r.status === "done" ? "info" : "success"} dot>
                        {t(`citizen.status.${r.status}`, r.status)}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{r.description}</p>
                    <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                      <MapPin className="h-3 w-3" aria-hidden="true" />
                      {r.area_village ? `${r.area_village}, ` : ""}
                      {r.district || "—"}
                    </p>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                        <Star className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                        {r.citizen.name}
                      </p>
                      <p className="text-xs text-gray-400">
                        {t("requests.holdPhone", "phone shared with you")}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <a
                        href={`tel:${r.citizen.phone}`}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-3.5 py-2 transition active:scale-95"
                      >
                        <Phone className="h-4 w-4" aria-hidden="true" />{" "}
                        {t("requests.call", "Call")}
                      </a>
                      <a
                        href={`sms:${r.citizen.phone}`}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-brand-50 dark:bg-brand-900/30 border border-brand-100 dark:border-brand-800/50 text-brand-700 dark:text-brand-400 text-sm font-medium px-3.5 py-2 transition active:scale-95"
                      >
                        <MessageSquare className="h-4 w-4" aria-hidden="true" />{" "}
                        {t("requests.sms", "SMS")}
                      </a>
                    </div>
                  </div>
                </div>
              </Card>
            ))
          )}
        </section>

        <p className="text-xs text-gray-400">
          {t(
            "requests.safetyNote",
            "Safety: meet in public where possible, agree the day's rate before starting, and report problems through Grievances.",
          )}
        </p>
      </div>
      <BottomNav />
    </Screen>
  );
}
