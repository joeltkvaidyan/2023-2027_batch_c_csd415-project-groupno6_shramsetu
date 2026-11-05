import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  Briefcase,
  ClipboardList,
  Clock,
  LogOut,
  MessageSquare,
  Phone,
  Plus,
  Search,
  Star,
  Users,
} from "lucide-react";
import { employerApi, clearEmployerToken } from "../api/client";
import { apiErrorMessage } from "../api/client";
import type { PublicWorker, PublicWorkersResponse } from "../types";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Avatar } from "../components/ui/Avatar";
import { EmptyState } from "../components/ui/EmptyState";
import { StatCard, StatGrid } from "../components/ui/StatCard";
import { Modal } from "../components/ui/Modal";

/** Fresh profile from /auth/employer/me — the acceptance gate state lives here. */
interface EmployerProfile {
  id: string;
  full_name: string;
  business_name: string | null;
  mobile_number: string;
  gov_approve_status: string;
  current_village_or_city: string | null;
  current_district: string | null;
  current_state: string | null;
}

interface EmployerJob {
  id: string;
  title: string;
  status: "open" | "closed";
  occupation: string;
  district: string | null;
  state: string;
  openings: number;
  applications_count: number;
  shortlisted_count: number;
  created_at: string;
}

const WAGE_PERIODS = ["day", "week", "month"];
const WORK_TYPES = ["daily", "part_time", "full_time", "seasonal"];

export default function EmployerDashboardPage() {
  const navigate = useNavigate();
  const [workers, setWorkers] = useState<PublicWorker[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [place, setPlace] = useState("");
  const [occupation, setOccupation] = useState("");
  const [note, setNote] = useState<string | null>(null);

  // Fresh acceptance state; null until /auth/employer/me answers.
  const [profile, setProfile] = useState<EmployerProfile | null>(null);
  const accepted = (profile?.gov_approve_status ?? "pending") === "accepted";

  // Job posting + my listings (employer self-service, gov-accepted only).
  const [occupations, setOccupations] = useState<string[]>([]);
  const [myJobs, setMyJobs] = useState<EmployerJob[] | null>(null);
  const [showPostForm, setShowPostForm] = useState(false);
  const [postForm, setPostForm] = useState({
    title: "",
    description: "",
    occupation: "",
    state: "",
    district: "",
    work_location: "",
    wage_min: "",
    wage_max: "",
    wage_period: "day",
    work_type: "daily",
    openings: "1",
    contact_phone: "",
  });
  const [postBusy, setPostBusy] = useState(false);

  // Rating modal state
  const [ratingWorker, setRatingWorker] = useState<PublicWorker | null>(null);
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState("");
  const [employerName, setEmployerName] = useState("");
  const [ratingBusy, setRatingBusy] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("employer_token")) {
      navigate("/employer/login", { replace: true });
      return;
    }
    // Refresh the acceptance status from the server on every visit —
    // localStorage snapshots go stale the moment the office decides.
    employerApi
      .get<EmployerProfile>("/auth/employer/me")
      .then((res) => {
        setProfile(res.data);
        localStorage.setItem("employer_user", JSON.stringify(res.data));
        return employerApi.get("/directory/occupations");
      })
      .then((res) => setOccupations(res?.data?.occupations ?? []))
      .catch((err) => {
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
          clearEmployerToken();
          localStorage.removeItem("employer_user");
          navigate("/employer/login", { replace: true });
        }
        // Other failures: keep the localStorage snapshot if one exists.
        const cached = localStorage.getItem("employer_user");
        if (cached) {
          try {
            setProfile(JSON.parse(cached));
            void employerApi.get("/directory/occupations").then((r) => setOccupations(r?.data?.occupations ?? []));
          } catch {
            /* ignore malformed cache */
          }
        }
      });
  }, [navigate]);

  const load = useCallback(async () => {
    setError("");
    try {
      // Signed-in listing: unlike /public/workers this one carries the
      // worker's contact number so the employer can call them directly.
      const res = await employerApi.get<PublicWorkersResponse>("/directory/workers", {
        params: Object.fromEntries(
          Object.entries({ name: search, place, occupation }).filter(([, v]) => v)
        ),
      });
      setWorkers(res.data.workers);
    } catch (err) {
      setWorkers([]);
      setError(apiErrorMessage(err));
    }
  }, [search, place, occupation]);

  // My postings + their applicant counts, reloaded on demand.
  const loadMyJobs = useCallback(async () => {
    if (!localStorage.getItem("employer_token")) return;
    try {
      const res = await employerApi.get("/jobs/posted");
      setMyJobs(res.data.jobs ?? []);
    } catch {
      setMyJobs([]);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadMyJobs();
  }, [load, loadMyJobs]);

  const setPostField = (key: keyof typeof postForm, value: string) =>
    setPostForm((f) => ({ ...f, [key]: value }));

  const submitJob = async () => {
    setPostBusy(true);
    setError("");
    try {
      await employerApi.post("/jobs", {
        title: postForm.title.trim(),
        description: postForm.description.trim(),
        occupation: postForm.occupation || "any",
        state: postForm.state.trim() || profile?.current_state || "",
        district: postForm.district.trim() || undefined,
        work_location: postForm.work_location.trim() || undefined,
        wage_min: postForm.wage_min || undefined,
        wage_max: postForm.wage_max || undefined,
        wage_period: postForm.wage_period,
        work_type: postForm.work_type,
        openings: postForm.openings || 1,
        contact_phone: postForm.contact_phone.trim() || undefined,
      });
      setNote("✅ Listing posted. Workers can now find it in their matched jobs.");
      setPostForm((f) => ({ ...f, title: "", description: "", work_location: "", wage_min: "", wage_max: "", contact_phone: "" }));
      setShowPostForm(false);
      void loadMyJobs();
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Could not post the listing.");
    } finally {
      setPostBusy(false);
    }
  };

  const setJobStatus = async (job: EmployerJob, status: "open" | "closed") => {
    try {
      await employerApi.patch(`/jobs/${job.id}/status`, { status });
      void loadMyJobs();
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Could not update the listing.");
    }
  };

  const handleRate = (worker: PublicWorker) => {
    if (!accepted) return;
    setRatingWorker(worker);
    setStars(5);
    setComment("");
    setEmployerName("");
  };

  const saveRating = async () => {
    if (!ratingWorker) return;
    setRatingBusy(true);
    try {
      await employerApi.post(`/ratings/worker/${ratingWorker.id}`, {
        stars,
        comment,
        employer_name: employerName || undefined,
      });
      setNote(`Rated ${ratingWorker.full_name}: ${stars}★`);
      setRatingWorker(null);
      void load();
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Could not save the rating.");
    } finally {
      setRatingBusy(false);
    }
  };

  const logout = () => {
    clearEmployerToken();
    localStorage.removeItem("employer_user");
    navigate("/employer/login", { replace: true });
  };

  const stats = useMemo(() => {
    const count = workers?.length ?? 0;
    const totalRatings = workers?.reduce((acc, w) => acc + (w.rating.count ?? 0), 0) ?? 0;
    const rated = workers?.filter((w) => w.rating.average != null) ?? [];
    const avgRating =
      rated.length > 0
        ? rated.reduce((acc, w) => acc + (w.rating.average ?? 0), 0) / rated.length
        : 0;
    return {
      workersFound: count,
      totalRatings,
      avgRating,
      searchActive: Boolean(search || place || occupation),
    };
  }, [workers, search, place, occupation]);

  const filteredWorkers = useMemo(() => workers ?? [], [workers]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-20">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-brand-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-600/25">
              <Users className="h-5 w-5 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">Employer Portal</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {profile?.business_name || profile?.full_name || "Hire trusted, government-approved workers"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {profile && (
              <span
                className={`hidden sm:inline-flex text-xs font-semibold rounded-full px-2.5 py-1 border ${
                  accepted
                    ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-100 dark:border-green-800/50"
                    : "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-800/50"
                }`}
              >
                {accepted ? "✓ Labour office accepted" : "⏳ Pending review"}
              </span>
            )}
            <button
              onClick={logout}
              className="text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 flex items-center gap-1.5 transition"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 space-y-6">
        {/* Pending review banner — the same gate workers face, mirrored here */}
        {profile && !accepted && (
          <Card className="border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20">
            <div className="flex items-start gap-3 p-4">
              <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">
                  Waiting for labour-office acceptance
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  Your account is queued with the State/District Labour Office
                  {profile.current_district ? ` (${profile.current_district})` : ""}. Until it is accepted you can
                  browse the worker directory, but <b>posting a job listing</b> and <b>rating workers</b> stay locked —
                  the same rule workers face before they can apply anywhere.
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Welcome + stats */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Find workers</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Browse government-accepted workers in your area, see their number and call them.
              </p>
            </div>
            <Badge tone="success">Contact numbers for signed-in employers</Badge>
          </div>

          <StatGrid>
            <StatCard label="Workers found" value={stats.workersFound} icon={<Users className="h-5 w-5" />} />
            <StatCard
              label="Total ratings"
              value={stats.totalRatings}
              icon={<Star className="h-5 w-5 text-amber-500" />}
            />
            <StatCard
              label="Avg. rating"
              value={stats.avgRating.toFixed(1)}
              trend="community feedback"
              icon={<Star className="h-5 w-5 text-amber-500" />}
            />
            <StatCard
              label="My listings"
              value={myJobs?.length ?? "—"}
              trend={accepted ? "open + closed" : "locked until review"}
              icon={<Briefcase className="h-5 w-5 text-brand-500" />}
            />
          </StatGrid>
        </div>

        {error && (
          <Card className="border-red-100 dark:border-red-900/30 bg-red-50 dark:bg-red-900/20">
            <div className="flex items-start gap-3 p-4">
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          </Card>
        )}

        {note && (
          <Card className="border-emerald-100 dark:border-emerald-900/30 bg-emerald-50 dark:bg-emerald-900/20">
            <div className="flex items-start gap-3 p-4">
              <Star className="h-5 w-5 text-emerald-500 shrink-0" />
              <p className="text-sm text-emerald-700 dark:text-emerald-300">{note}</p>
            </div>
          </Card>
        )}

        {/* Post a job (employer self-service, gated) */}
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                  accepted ? "bg-brand-100 dark:bg-brand-900/30" : "bg-gray-100 dark:bg-gray-800"
                }`}
              >
                <Briefcase className={`h-4.5 w-4.5 ${accepted ? "text-brand-600 dark:text-brand-400" : "text-gray-400"}`} aria-hidden="true" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-gray-100">Post a job listing</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {accepted
                    ? "Your listings appear in workers' matched jobs with an honest 'poster accepted' signal — never certified as verified."
                    : "Locked until a labour office accepts your account."}
                </p>
              </div>
            </div>
            <Button
              onClick={() => setShowPostForm((v) => !v)}
              disabled={!accepted}
              title={accepted ? undefined : "Pending labour-office review"}
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> {showPostForm ? "Hide form" : "New listing"}
            </Button>
          </div>

          {accepted && showPostForm && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitJob();
              }}
              className="mt-4 space-y-3 border-t border-gray-100 dark:border-gray-700 pt-4"
            >
              <input
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 outline-none"
                placeholder="Job title (e.g. Mason helper needed at site)"
                value={postForm.title}
                onChange={(e) => setPostField("title", e.target.value)}
                required
                minLength={5}
                maxLength={120}
              />
              <textarea
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 outline-none"
                rows={3}
                placeholder="Describe the work, payment terms and location (min 20 characters)…"
                value={postForm.description}
                onChange={(e) => setPostField("description", e.target.value)}
                required
                minLength={20}
                maxLength={2000}
              />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <select
                  className="px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 outline-none"
                  value={postForm.occupation}
                  onChange={(e) => setPostField("occupation", e.target.value)}
                  required
                >
                  <option value="">Trade…</option>
                  {occupations.map((o) => (
                    <option key={o} value={o}>
                      {o.replace(/_/g, " ")}
                    </option>
                  ))}
                  <option value="any">any trade</option>
                </select>
                <input
                  className="px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 outline-none"
                  placeholder={`State${profile?.current_state ? ` (e.g. ${profile.current_state})` : ""}`}
                  value={postForm.state}
                  onChange={(e) => setPostField("state", e.target.value)}
                  required
                />
                <input
                  className="px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 outline-none"
                  placeholder="District (optional)"
                  value={postForm.district}
                  onChange={(e) => setPostField("district", e.target.value)}
                />
                <input
                  className="px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 outline-none"
                  placeholder="Work location (optional)"
                  value={postForm.work_location}
                  onChange={(e) => setPostField("work_location", e.target.value)}
                />
                <input
                  type="number"
                  min={0}
                  className="px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 outline-none"
                  placeholder="Wage min (₹)"
                  value={postForm.wage_min}
                  onChange={(e) => setPostField("wage_min", e.target.value)}
                />
                <input
                  type="number"
                  min={0}
                  className="px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 outline-none"
                  placeholder="Wage max (₹)"
                  value={postForm.wage_max}
                  onChange={(e) => setPostField("wage_max", e.target.value)}
                />
                <select
                  className="px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 outline-none"
                  value={postForm.wage_period}
                  onChange={(e) => setPostField("wage_period", e.target.value)}
                >
                  {WAGE_PERIODS.map((p) => (
                    <option key={p} value={p}>
                      per {p}
                    </option>
                  ))}
                </select>
                <select
                  className="px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 outline-none"
                  value={postForm.work_type}
                  onChange={(e) => setPostField("work_type", e.target.value)}
                >
                  {WORK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={500}
                  className="px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 outline-none"
                  placeholder="Openings"
                  value={postForm.openings}
                  onChange={(e) => setPostField("openings", e.target.value)}
                />
                <input
                  className="px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 outline-none"
                  placeholder="Contact phone (optional)"
                  value={postForm.contact_phone}
                  onChange={(e) => setPostField("contact_phone", e.target.value.replace(/\D/g, ""))}
                  maxLength={12}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-gray-400">
                  ShramSetu never certifies a listing. Workers see your account is gov-accepted, not that this post was vetted.
                </p>
                <Button type="submit" loading={postBusy}>
                  Post listing
                </Button>
              </div>
            </form>
          )}
        </Card>

        {/* My listings */}
        {myJobs !== null && myJobs.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4.5 w-4.5 text-gray-500" aria-hidden="true" />
              <h3 className="font-bold text-gray-900 dark:text-gray-100">My listings</h3>
              <span className="text-xs text-gray-400">{myJobs.length}</span>
            </div>
            {myJobs.map((job) => (
              <Card key={job.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-gray-900 dark:text-gray-100">{job.title}</h4>
                      <span
                        className={`text-xs font-semibold rounded-full px-2 py-0.5 border ${
                          job.status === "open"
                            ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-100 dark:border-green-800/50"
                            : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700"
                        }`}
                      >
                        {job.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {job.occupation.replace(/_/g, " ")} • {job.district ? `${job.district}, ` : ""}
                      {job.state} • {job.openings} opening{job.openings === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={job.applications_count > 0 ? "brand" : "neutral"}>
                      {job.applications_count} applied{job.shortlisted_count ? ` · ${job.shortlisted_count} read` : ""}
                    </Badge>
                    <Button variant="ghost" size="sm" onClick={() => void setJobStatus(job, job.status === "open" ? "closed" : "open")}>
                      {job.status === "open" ? "Close" : "Reopen"}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </section>
        )}

        {/* Search filters */}
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                Worker name
              </label>
              <input
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition"
                placeholder="Search by name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                Place / district
              </label>
              <input
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition"
                placeholder="District or town…"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                Trade / occupation
              </label>
              <select
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition"
                value={occupation}
                onChange={(e) => setOccupation(e.target.value)}
                aria-label="Filter by trade"
              >
                <option value="">Any trade</option>
                {occupations.map((o) => (
                  <option key={o} value={o}>
                    {o.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={() => void load()} className="px-5 py-2.5">
              <Search className="h-4 w-4" aria-hidden="true" /> Search
            </Button>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Only government-accepted workers appear. Their mobile number is shown to your signed-in
            account so you can call about work — use it for nothing else. Street addresses and
            documents are never shown.
          </p>
        </Card>

        {/* Worker list */}
        {workers === null ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-brand-100 dark:bg-brand-900/20 animate-pulse" />
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading workers…</p>
            </div>
          </div>
        ) : filteredWorkers.length === 0 ? (
          <EmptyState
            icon={Users}
            title={stats.searchActive ? "No workers match your search" : "No workers found"}
            description={
              stats.searchActive
                ? "Try adjusting your name, place, or trade filters."
                : "There are no government-accepted workers in the directory yet."
            }
            action={
              <Button variant="ghost" onClick={() => {
                setSearch("");
                setPlace("");
                setOccupation("");
                void load();
              }}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {filteredWorkers.map((w) => {
              const isRating = ratingWorker?.id === w.id;
              return (
                <Card key={w.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={w.full_name} size="md" />
                      <div>
                        <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{w.full_name}</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                          {w.occupation?.replace(/_/g, " ") || "Trade not recorded"}
                          {w.years_of_experience != null ? ` • ${w.years_of_experience} yrs` : ""}
                          {w.place ? ` • ${w.place}` : ""}
                        </p>
                        <div className="flex items-center gap-1 mt-1">
                          <span className="text-xs font-semibold bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-100 dark:border-green-800/50 rounded-full px-2 py-0.5">
                            Gov approved
                          </span>
                          <div className="flex items-center gap-1 text-xs">
                            <span className="text-amber-500" aria-hidden="true">★</span>
                            <span className="text-gray-700 dark:text-gray-300">
                              {w.rating.average?.toFixed(1) ?? "—"}
                            </span>
                            <span className="text-gray-400">({w.rating.count ?? 0})</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                          <Badge tone="brand">
                            {w.worker_code}
                          </Badge>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRate(w);
                        }}
                        className="text-sm font-medium bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-400 border border-brand-100 dark:border-brand-800/50 rounded-xl px-3 py-1.5 hover:bg-brand-100 dark:hover:bg-brand-900/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={isRating || !accepted}
                        title={accepted ? undefined : "Locked until labour-office acceptance"}
                      >
                        {isRating ? "Rating…" : accepted ? "Rate" : "Locked"}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
                    <div className="p-2.5 rounded-xl bg-gray-50 dark:bg-gray-700/30">
                      <p className="text-xs text-gray-400 uppercase font-semibold">Experience</p>
                      <p className="text-gray-900 dark:text-gray-100 font-medium">
                        {w.years_of_experience != null ? w.years_of_experience : "—"} yrs
                      </p>
                    </div>
                    <div className="p-2.5 rounded-xl bg-gray-50 dark:bg-gray-700/30">
                      <p className="text-xs text-gray-400 uppercase font-semibold">Location</p>
                      <p className="text-gray-900 dark:text-gray-100 font-medium truncate">
                        {w.place || "Not recorded"}
                      </p>
                    </div>
                  </div>

                  {w.phone ? (
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-50 dark:bg-brand-900/20 border border-brand-100 dark:border-brand-800/50 px-3 py-2.5">
                      <p className="text-sm font-semibold text-brand-800 dark:text-brand-300 flex items-center gap-2">
                        <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <a href={`tel:+91${w.phone}`} className="hover:underline">
                          +91 {w.phone}
                        </a>
                      </p>
                      <div className="flex items-center gap-2">
                        <a
                          href={`tel:+91${w.phone}`}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-3.5 py-2 transition active:scale-95"
                        >
                          <Phone className="h-4 w-4" aria-hidden="true" /> Call
                        </a>
                        <a
                          href={`sms:+91${w.phone}`}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-white dark:bg-gray-800 border border-brand-200 dark:border-brand-800/60 text-brand-700 dark:text-brand-300 text-sm font-medium px-3.5 py-2 transition active:scale-95"
                        >
                          <MessageSquare className="h-4 w-4" aria-hidden="true" /> SMS
                        </a>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 mb-3">
                      No verified number on this account yet — use a job listing to reach them.
                    </p>
                  )}

                  <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-700">
                    <p className="text-xs text-gray-400">
                      Contact only about work. ShramSetu does not verify that this number is still in use.
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRate(w)}
                      disabled={isRating || !accepted}
                      title={accepted ? undefined : "Locked until labour-office acceptance"}
                    >
                      <Star className="h-4 w-4" aria-hidden="true" /> Rate worker
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      {/* Rating Modal */}
      <Modal
        open={ratingWorker != null}
        onClose={() => setRatingWorker(null)}
        title={`Rate ${ratingWorker?.full_name}`}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar name={ratingWorker?.full_name || ""} size="sm" />
            <div>
              <p className="font-medium text-gray-900 dark:text-gray-100">{ratingWorker?.full_name}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {ratingWorker?.occupation?.replace(/_/g, " ")} • {ratingWorker?.place || "Location not recorded"}
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Your rating
            </label>
            <div className="flex items-center gap-1">
              {[5, 4, 3, 2, 1].map((n) => (
                <button
                  key={n}
                  onClick={() => setStars(n)}
                  aria-label={`${n} stars`}
                  className={`text-2xl transition ${n <= stars ? "text-amber-500" : "text-gray-300"}`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Business / site name (optional)
            </label>
            <input
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 outline-none"
              placeholder="e.g. Ravi Constructions"
              value={employerName}
              onChange={(e) => setEmployerName(e.target.value.slice(0, 120))}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Comment (optional)
            </label>
            <textarea
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-brand-500 outline-none"
              rows={3}
              placeholder="Share your experience hiring this worker…"
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, 300))}
            />
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 p-3">
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={() => setRatingWorker(null)}>
            Cancel
          </Button>
          <Button onClick={saveRating} loading={ratingBusy} disabled={!ratingWorker}>
            Save rating
          </Button>
        </div>
      </Modal>
    </div>
  );
}
