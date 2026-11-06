import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Briefcase,
  CheckCircle2,
  Clock,
  Home,
  LogOut,
  MessageSquare,
  Phone,
  Plus,
  Search,
  Star,
} from "lucide-react";
import { citizenApi, clearCitizenToken, apiErrorDetail, httpStatus } from "../api/client";
import { apiErrorMessage } from "../api/client";
import type { PublicWorker, PublicWorkersResponse } from "../types";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Avatar } from "../components/ui/Avatar";
import { EmptyState } from "../components/ui/EmptyState";

interface CitizenProfile {
  id: string;
  full_name: string;
  current_village_or_city: string | null;
  current_district: string | null;
  current_state: string | null;
}

/** Citizen's own request as returned by /requests/mine */
interface MyRequest {
  id: string;
  occupation: string;
  description: string;
  area_village: string | null;
  district: string | null;
  state: string | null;
  preferred_time: string | null;
  status: "open" | "accepted" | "done" | "cancelled";
  created_at: string;
  worker: {
    id: string;
    worker_code: string;
    full_name: string;
    occupation: string | null;
    phone: string;
  } | null;
}

const STATUS_TONE: Record<MyRequest["status"], "success" | "warning" | "info" | "neutral"> = {
  open: "warning",
  accepted: "success",
  done: "info",
  cancelled: "neutral",
};

export default function CitizenDashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<CitizenProfile | null>(null);
  const [requests, setRequests] = useState<MyRequest[] | null>(null);
  const [workers, setWorkers] = useState<PublicWorker[] | null>(null);
  const [occupations, setOccupations] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    occupation: "",
    description: "",
    area_village: "",
    district: "",
    state: "",
    preferred_time: "",
  });
  const [formBusy, setFormBusy] = useState(false);

  const logout = useCallback(() => {
    clearCitizenToken();
    localStorage.removeItem("citizen_user");
    navigate("/citizen/login", { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (!localStorage.getItem("citizen_token")) navigate("/citizen/login", { replace: true });
  }, [navigate]);

  const loadAll = useCallback(async () => {
    setError("");
    try {
      const me = await citizenApi.get<CitizenProfile>("/auth/citizen/me");
      setProfile(me.data);
      const mine = await citizenApi.get("/requests/mine");
      setRequests((mine.data.requests ?? []) as MyRequest[]);
      // Signed-in listing: carries the worker's contact number so the
      // household can call about the work directly.
      const dir = await citizenApi.get<PublicWorkersResponse>("/directory/workers", {
        params: { place: me.data.current_district || me.data.current_state || "" },
      });
      setWorkers(dir.data.workers);
    } catch (err) {
      if (httpStatus(err) === 401 || httpStatus(err) === 403) {
        logout();
        return;
      }
      setError(apiErrorMessage(err));
      setRequests([]);
    }
    try {
      const occ = await citizenApi.get("/directory/occupations");
      setOccupations(occ.data.occupations ?? []);
    } catch {
      /* the trade list is non-critical */
    }
  }, [logout]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const prefilled = useCallback(() => {
    if (profile) {
      setForm((f) => ({
        ...f,
        area_village: f.area_village || profile.current_village_or_city || "",
        district: f.district || profile.current_district || "",
        state: f.state || profile.current_state || "",
      }));
    }
  }, [profile]);

  useEffect(() => {
    prefilled();
  }, [prefilled]);

  const submitRequest = async () => {
    setFormBusy(true);
    setError("");
    try {
      await citizenApi.post("/requests", {
        occupation: form.occupation || "any",
        description: form.description.trim(),
        area_village: form.area_village.trim() || undefined,
        district: form.district.trim() || undefined,
        state: form.state.trim() || undefined,
        preferred_time: form.preferred_time.trim() || undefined,
      });
      setNote(
        t("citizen.requestPosted", "Request posted. Workers near you will see it in their app."),
      );
      setForm((f) => ({ ...f, occupation: "", description: "", preferred_time: "" }));
      setShowForm(false);
      void loadAll();
    } catch (err) {
      setError(apiErrorDetail(err) || t("citizen.postFailed", "Could not post the request."));
    } finally {
      setFormBusy(false);
    }
  };

  const cancelRequest = async (id: string) => {
    setBusyId(id);
    try {
      await citizenApi.post(`/requests/${id}/cancel`);
      void loadAll();
    } catch (err) {
      setError(apiErrorDetail(err) || t("citizen.cancelFailed", "Could not cancel."));
    } finally {
      setBusyId(null);
    }
  };

  const markDone = async (id: string) => {
    setBusyId(id);
    try {
      await citizenApi.post(`/requests/${id}/done`);
      setNote(
        t(
          "citizen.doneHint",
          "Marked done. If the work went well, you can rate the worker publicly in the directory below.",
        ),
      );
      void loadAll();
    } catch (err) {
      setError(apiErrorDetail(err) || t("citizen.doneFailed", "Could not update."));
    } finally {
      setBusyId(null);
    }
  };

  const openCount = requests?.filter((r) => r.status === "open").length ?? 0;
  const activeCount = requests?.filter((r) => r.status === "accepted").length ?? 0;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-20">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-brand-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-600/25">
              <Home className="h-5 w-5 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {t("citizen.dashboardTitle", "Household")}
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {profile?.full_name || t("citizen.motto", "Reach verified workers safely")}
              </p>
            </div>
          </div>
          <button
            onClick={logout}
            className="text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 flex items-center gap-1.5 transition"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" /> {t("citizen.signOut", "Sign out")}
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: t("citizen.stOpen", "Open"), value: openCount },
            { label: t("citizen.stActive", "Accepted"), value: activeCount },
            { label: t("citizen.stWorkers", "Workers near you"), value: workers?.length ?? "—" },
          ].map((s) => (
            <Card key={s.label} className="text-center py-4">
              <p className="text-xl font-bold text-brand-700 dark:text-brand-400">{s.value}</p>
              <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">
                {s.label}
              </p>
            </Card>
          ))}
        </div>

        {error && (
          <Card className="border-red-100 dark:border-red-900/30 bg-red-50 dark:bg-red-900/20 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          </Card>
        )}
        {note && (
          <Card className="border-emerald-100 dark:border-emerald-900/30 bg-emerald-50 dark:bg-emerald-900/20 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
              <p className="text-sm text-emerald-700 dark:text-emerald-300">{note}</p>
            </div>
          </Card>
        )}

        {/* Post a request */}
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
                <Plus
                  className="h-4.5 w-4.5 text-brand-600 dark:text-brand-400"
                  aria-hidden="true"
                />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-gray-100">
                  {t("citizen.postTitle", "Request a worker")}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t(
                    "citizen.postHint",
                    "Tell the trade, what, where and when — a matching worker accepts, then you call.",
                  )}
                </p>
              </div>
            </div>
            <Button onClick={() => setShowForm((v) => !v)}>
              {showForm
                ? t("citizen.hideForm", "Hide form")
                : t("citizen.newRequest", "New request")}
            </Button>
          </div>

          {showForm && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitRequest();
              }}
              className="mt-4 space-y-3 border-t border-gray-100 dark:border-gray-700 pt-4"
            >
              <div className="grid grid-cols-2 gap-3">
                <select
                  className="px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                  value={form.occupation}
                  onChange={(e) => setForm((f) => ({ ...f, occupation: e.target.value }))}
                >
                  <option value="any">{t("citizen.anyTrade", "Any trade")}</option>
                  {occupations.map((o) => (
                    <option key={o} value={o}>
                      {o.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
                <input
                  className="px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                  placeholder={t("citizen.preferredTime", "Preferred time (e.g. mornings)")}
                  value={form.preferred_time}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, preferred_time: e.target.value.slice(0, 60) }))
                  }
                />
                <input
                  className="px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                  placeholder={t("citizen.areaPlaceholder", "Area / village")}
                  value={form.area_village}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, area_village: e.target.value.slice(0, 120) }))
                  }
                />
                <input
                  className="px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                  placeholder={t("citizen.districtPlaceholder", "District")}
                  value={form.district}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, district: e.target.value.slice(0, 80) }))
                  }
                />
              </div>
              <input
                className="px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none w-full"
                placeholder={t("citizen.statePlaceholder", "State")}
                value={form.state}
                onChange={(e) => setForm((f) => ({ ...f, state: e.target.value.slice(0, 80) }))}
              />
              <textarea
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                rows={3}
                required
                minLength={5}
                maxLength={500}
                placeholder={t(
                  "citizen.describeWork",
                  "What needs doing? (e.g. two days of help replacing tiles on the veranda)",
                )}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-gray-400">
                  {t(
                    "citizen.phoneGate",
                    "🔒 Your number only reaches the worker who ACCEPTS your request — and theirs to you.",
                  )}
                </p>
                <Button type="submit" loading={formBusy}>
                  {t("citizen.post", "Post request")}
                </Button>
              </div>
            </form>
          )}
        </Card>

        {/* My requests */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Briefcase className="h-4.5 w-4.5 text-gray-500" aria-hidden="true" />
            <h3 className="font-bold text-gray-900 dark:text-gray-100">
              {t("citizen.myRequests", "My requests")}
            </h3>
          </div>
          {requests === null ? (
            <p className="text-center text-sm text-gray-400 py-6">
              {t("citizen.loading", "Loading…")}
            </p>
          ) : requests.length === 0 ? (
            <EmptyState
              icon={Briefcase}
              title={t("citizen.noRequests", "No requests yet")}
              description={t(
                "citizen.noRequestsHint",
                "Post one above and matching workers near you will be notified in their app.",
              )}
            />
          ) : (
            requests.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-gray-900 dark:text-gray-100 capitalize">
                        {r.occupation.replace(/_/g, " ")}
                      </h4>
                      <Badge tone={STATUS_TONE[r.status]} dot>
                        {t(`citizen.status.${r.status}`, r.status)}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-1.5">
                      {r.description}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {r.area_village ? `${r.area_village}, ` : ""}
                      {r.district || "—"}
                      {r.preferred_time ? ` • ${r.preferred_time}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.status === "open" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busyId === r.id}
                        onClick={() => void cancelRequest(r.id)}
                      >
                        {t("citizen.cancel", "Cancel")}
                      </Button>
                    )}
                    {r.status === "accepted" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busyId === r.id}
                        onClick={() => void markDone(r.id)}
                      >
                        {t("citizen.markDone", "Mark done")}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Contact reveal — only once the worker accepted */}
                {r.worker && (
                  <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 bg-brand-50/50 dark:bg-brand-900/10 rounded-xl p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={r.worker.full_name} size="sm" />
                        <div>
                          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {r.worker.full_name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {r.worker.worker_code} • {r.worker.occupation?.replace(/_/g, " ") || ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <a
                          href={`tel:${r.worker.phone}`}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-3.5 py-2 transition active:scale-95"
                        >
                          <Phone className="h-4 w-4" aria-hidden="true" />{" "}
                          {t("citizen.call", "Call")}
                        </a>
                        <a
                          href={`sms:${r.worker.phone}`}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-50 dark:bg-brand-900/30 border border-brand-100 dark:border-brand-800/50 text-brand-700 dark:text-brand-400 text-sm font-medium px-3.5 py-2 transition active:scale-95"
                        >
                          <MessageSquare className="h-4 w-4" aria-hidden="true" />{" "}
                          {t("citizen.sms", "SMS")}
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            ))
          )}
        </section>

        {/* Workers near me */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Search className="h-4.5 w-4.5 text-gray-500" aria-hidden="true" />
            <h3 className="font-bold text-gray-900 dark:text-gray-100">
              {t("citizen.nearbyTitle", "Workers near you")}
            </h3>
            {profile?.current_district && <Badge tone="brand">{profile.current_district}</Badge>}
          </div>
          {workers === null ? (
            <p className="text-center text-sm text-gray-400 py-6">
              {t("citizen.loading", "Loading…")}
            </p>
          ) : workers.length === 0 ? (
            <EmptyState
              icon={Search}
              title={t("citizen.noWorkers", "No listed workers here yet")}
              description={t(
                "citizen.noWorkersHint",
                "Only government-accepted workers are listed in the directory. You can still post a request above.",
              )}
            />
          ) : (
            workers.map((w) => (
              <Card key={w.id} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={w.full_name} size="md" />
                    <div className="min-w-0">
                      <h4 className="text-base font-bold text-gray-900 dark:text-gray-100 truncate">
                        {w.full_name} <span className="text-xs font-normal">{w.worker_code}</span>
                      </h4>
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                        {w.occupation?.replace(/_/g, " ")} • {w.place || ""}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs font-semibold bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-100 dark:border-green-800/50 rounded-full px-2 py-0.5">
                          {t("citizen.govAccepted", "gov accepted")}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                          <Star className="h-3 w-3 text-amber-500" aria-hidden="true" />
                          {w.rating.average?.toFixed(1) ?? "—"} ({w.rating.count ?? 0})
                        </span>
                      </div>
                    </div>
                  </div>
                  {w.phone ? (
                    <a
                      href={`tel:+91${w.phone}`}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-3.5 py-2 transition active:scale-95"
                      aria-label={`Call ${w.full_name}`}
                    >
                      <Phone className="h-4 w-4" aria-hidden="true" /> {t("citizen.call", "Call")}
                    </a>
                  ) : (
                    <Clock className="h-4 w-4 text-gray-300 shrink-0" aria-hidden="true" />
                  )}
                </div>
                {w.phone && (
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                    <Phone className="h-3 w-3" aria-hidden="true" /> +91 {w.phone}
                  </p>
                )}
              </Card>
            ))
          )}
          <p className="text-xs text-gray-400">
            {t(
              "citizen.directoryNote",
              "Numbers are shown to your signed-in household account so you can call about work. Use them only for that — posting a request still gets the worker to call you back.",
            )}
          </p>
        </section>
      </main>
    </div>
  );
}
