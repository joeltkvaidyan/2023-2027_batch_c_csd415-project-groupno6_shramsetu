import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  govCreateJob,
  govGetJobApplicants,
  govGetPostedJobs,
  govReviewJobApplicant,
  govSetJobStatus,
  type GovJobApplicant,
  type GovJobPosting,
} from "../../api/governmentClient";
import { OCCUPATIONS, occupationLabelKey } from "../register/constants";

/**
 * Government-side job listings and applicant review.
 *
 * The office creates a listing inside its own jurisdiction (the server forces
 * state/district), sees how many workers applied, and triages applications.
 * Two boundaries are visible in the UI on purpose:
 *
 *  - a phone number is shown only when the worker ticked "share my number";
 *    otherwise the panel says to contact them through the office;
 *  - the fit score compares only the trade/district/state the worker entered,
 *    and "shortlisted" means "we read this", never "you have the job".
 */

const REVIEW_TONE: Record<string, string> = {
  strong: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  good: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  possible: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

const BAR_TONE: Record<string, string> = {
  strong: "bg-emerald-400",
  good: "bg-sky-400",
  possible: "bg-slate-400",
};

function initials(name: string | null) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export default function JobsPanel({ token }: { token: string | null }) {
  const { t } = useTranslation();

  const [jobs, setJobs] = useState<GovJobPosting[] | null>(null);
  const [applicants, setApplicants] = useState<Record<string, GovJobApplicant[]>>({});
  const [counts, setCounts] = useState<Record<string, { total: number; shortlisted: number }>>({});
  const [openReview, setOpenReview] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "shortlisted">("all");
  const [busyApplicant, setBusyApplicant] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    title: "",
    description: "",
    employer_name: "",
    occupation: "construction",
    district: "",
    work_location: "",
    wage_min: "",
    wage_max: "",
    openings: "1",
    contact_phone: "",
  });

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await govGetPostedJobs(token);
      setJobs(res.jobs);
      setError("");
    } catch {
      setJobs([]);
      setError(t("jobs.review.loadError", "Could not load your job listings."));
    }
  }, [token, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () =>
    setForm({
      title: "",
      description: "",
      employer_name: "",
      occupation: "construction",
      district: "",
      work_location: "",
      wage_min: "",
      wage_max: "",
      openings: "1",
      contact_phone: "",
    });

  const create = async () => {
    if (!token) return;
    setSaving(true);
    try {
      await govCreateJob(token, {
        title: form.title,
        description: form.description,
        employer_name: form.employer_name,
        occupation: form.occupation,
        district: form.district || null,
        work_location: form.work_location || null,
        wage_min: form.wage_min === "" ? null : Number(form.wage_min),
        wage_max: form.wage_max === "" ? null : Number(form.wage_max),
        openings: form.openings === "" ? 1 : Number(form.openings),
        contact_phone: form.contact_phone || null,
      });
      resetForm();
      setShowForm(false);
      await load();
    } catch (err) {
      const status = (err as { response?: { status?: number; data?: { detail?: string } } })
        ?.response;
      setError(
        status?.status === 403
          ? t("jobs.review.outsideJurisdiction", "That listing is outside your jurisdiction.")
          : status?.data?.detail || t("jobs.review.createError", "Could not create the listing."),
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (job: GovJobPosting) => {
    if (!token) return;
    try {
      await govSetJobStatus(token, job.id, job.status === "open" ? "closed" : "open");
      await load();
    } catch {
      setError(t("jobs.review.statusError", "Could not update the listing."));
    }
  };

  const openApplicants = async (job: GovJobPosting) => {
    if (!token) return;
    if (openReview === job.id) {
      setOpenReview(null);
      return;
    }
    try {
      const res = await govGetJobApplicants(token, job.id);
      setApplicants((prev) => ({ ...prev, [job.id]: res.applications }));
      setCounts((prev) => ({ ...prev, [job.id]: res.counts }));
      setFilter("all");
      setOpenReview(job.id);
    } catch {
      setError(t("jobs.review.applicantsError", "Could not load applicants."));
    }
  };

  const toggleShortlist = async (job: GovJobPosting, app: GovJobApplicant) => {
    if (!token) return;
    setBusyApplicant(app.id);
    const next = app.shortlisted ? "submitted" : "shortlisted";
    try {
      const updated = await govReviewJobApplicant(token, job.id, app.id, next);
      setApplicants((prev) => ({
        ...prev,
        [job.id]: (prev[job.id] ?? []).map((a) => (a.id === updated.id ? updated : a)),
      }));
      setCounts((prev) => {
        const current = prev[job.id] ?? { total: 0, shortlisted: 0 };
        const shortlisted = Math.max(0, current.shortlisted + (updated.shortlisted ? 1 : -1));
        return { ...prev, [job.id]: { total: current.total, shortlisted } };
      });
      setJobs((prev) =>
        prev
          ? prev.map((j) =>
              j.id === job.id
                ? {
                    ...j,
                    shortlisted_count: Math.max(
                      0,
                      (j.shortlisted_count ?? 0) + (updated.shortlisted ? 1 : -1),
                    ),
                  }
                : j,
            )
          : prev,
      );
    } catch {
      setError(t("jobs.review.reviewError", "Could not update the application."));
    } finally {
      setBusyApplicant(null);
    }
  };

  const field =
    "w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500";
  const label = "block text-xs font-medium text-slate-400 mb-1";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{t("jobs.review.panelTitle", "🧰 Job Listings")}</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {t(
              "jobs.review.panelSubtitle",
              "Publish work inside your jurisdiction, then review the workers who apply.",
            )}
          </p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-sm font-semibold transition"
        >
          {showForm ? t("common.cancel", "Cancel") : t("jobs.review.newListing", "+ New listing")}
        </button>
      </div>

      <p className="text-sm text-slate-400">
        {t(
          "jobs.review.unverifiedNote",
          "Listings are scoped to your jurisdiction and marked unverified for workers: ShramSetu cannot confirm that an employer will honour the stated wage.",
        )}
      </p>

      {error && (
        <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {showForm && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-5 space-y-3">
          <div>
            <label className={label} htmlFor="job-title">
              {t("jobs.review.titleLabel", "Job title")}
            </label>
            <input
              id="job-title"
              className={field}
              placeholder={t(
                "jobs.review.titlePlaceholder",
                "e.g. Mason required for apartment site",
              )}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div>
            <label className={label} htmlFor="job-description">
              {t("jobs.review.descriptionLabel", "Description")}
            </label>
            <textarea
              id="job-description"
              className={`${field} resize-none`}
              rows={3}
              placeholder={t(
                "jobs.review.descriptionPlaceholder",
                "Work, site, wage payment schedule, working hours",
              )}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="job-employer">
                {t("jobs.review.employerLabel", "Employer / contractor")}
              </label>
              <input
                id="job-employer"
                className={field}
                placeholder={t("jobs.review.employerPlaceholder", "Name as workers will see it")}
                value={form.employer_name}
                onChange={(e) => setForm({ ...form, employer_name: e.target.value })}
              />
            </div>
            <div>
              <label className={label} htmlFor="job-trade">
                {t("jobs.review.tradeLabel", "Trade")}
              </label>
              <select
                id="job-trade"
                className={field}
                value={form.occupation}
                onChange={(e) => setForm({ ...form, occupation: e.target.value })}
              >
                <option value="any">{t("jobs.allTrades", "Any trade")}</option>
                {OCCUPATIONS.map((code) => (
                  <option key={code} value={code}>
                    {t(occupationLabelKey(code), code.replace(/_/g, " "))}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="job-district">
                {t("jobs.review.districtLabel", "District")}
              </label>
              <input
                id="job-district"
                className={field}
                placeholder={t("jobs.review.districtPlaceholder", "Within your jurisdiction")}
                value={form.district}
                onChange={(e) => setForm({ ...form, district: e.target.value })}
              />
            </div>
            <div>
              <label className={label} htmlFor="job-location">
                {t("jobs.review.locationLabel", "Site / location")}
              </label>
              <input
                id="job-location"
                className={field}
                placeholder={t("jobs.review.locationPlaceholder", "Village, town or site")}
                value={form.work_location}
                onChange={(e) => setForm({ ...form, work_location: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor="job-wage-min">
                  {t("jobs.review.wageFrom", "Wage from (₹)")}
                </label>
                <input
                  id="job-wage-min"
                  className={field}
                  inputMode="numeric"
                  value={form.wage_min}
                  onChange={(e) => setForm({ ...form, wage_min: e.target.value })}
                />
              </div>
              <div>
                <label className={label} htmlFor="job-wage-max">
                  {t("jobs.review.wageTo", "Wage to (₹)")}
                </label>
                <input
                  id="job-wage-max"
                  className={field}
                  inputMode="numeric"
                  value={form.wage_max}
                  onChange={(e) => setForm({ ...form, wage_max: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className={label} htmlFor="job-openings">
                {t("jobs.review.openingsLabel", "Openings")}
              </label>
              <input
                id="job-openings"
                className={field}
                inputMode="numeric"
                value={form.openings}
                onChange={(e) => setForm({ ...form, openings: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className={label} htmlFor="job-phone">
              {t("jobs.review.contactLabel", "Contact phone (optional)")}
            </label>
            <input
              id="job-phone"
              className={field}
              inputMode="tel"
              placeholder={t(
                "jobs.review.contactPlaceholder",
                "Leave blank if unknown — workers will be told to apply through the portal",
              )}
              value={form.contact_phone}
              onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
            />
          </div>
          <button
            onClick={() => void create()}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-sm font-semibold"
          >
            {saving
              ? t("jobs.review.publishing", "Publishing…")
              : t("jobs.review.publish", "Publish listing")}
          </button>
        </div>
      )}

      {jobs === null ? (
        <p className="text-slate-500 text-center py-8">
          {t("jobs.review.loading", "Loading listings…")}
        </p>
      ) : jobs.length === 0 ? (
        <div className="bg-slate-800/40 border border-slate-700 rounded-2xl p-8 text-center">
          <p className="text-slate-300 font-medium">
            {t("jobs.review.noListings", "No listings posted yet.")}
          </p>
          <p className="text-sm text-slate-500 mt-1">
            {t(
              "jobs.review.noListingsHint",
              "Create a listing to start receiving applications from workers in your district.",
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const jobApplicants = applicants[job.id] ?? [];
            const jobCounts = counts[job.id] ?? {
              total: job.applications_count ?? 0,
              shortlisted: job.shortlisted_count ?? 0,
            };
            const visible =
              filter === "shortlisted" ? jobApplicants.filter((a) => a.shortlisted) : jobApplicants;

            return (
              <div
                key={job.id}
                className="bg-slate-800/50 border border-slate-700 rounded-2xl p-5 transition-colors hover:border-slate-600"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-100 truncate">{job.title}</h3>
                    <p className="text-sm text-slate-400">
                      {job.employer_name} · {[job.district, job.state].filter(Boolean).join(", ")}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${
                      job.status === "open"
                        ? "bg-green-500/20 text-green-400"
                        : "bg-slate-600/40 text-slate-300"
                    }`}
                  >
                    {job.status === "open"
                      ? t("jobs.review.open", "open")
                      : t("jobs.review.closed", "closed")}
                  </span>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 mt-2">
                  <span>
                    {t(occupationLabelKey(job.occupation), job.occupation.replace(/_/g, " "))}
                  </span>
                  <span>
                    {job.openings} {t("jobs.review.openingsShort", "opening(s)")}
                  </span>
                  {job.wage_max !== null && (
                    <span className="text-emerald-300">
                      ₹{job.wage_min ?? job.wage_max}–{job.wage_max}/{job.wage_period}
                    </span>
                  )}
                  <span>
                    {jobCounts.total} {t("jobs.review.applicantCount", "applicant(s)")}
                    {jobCounts.shortlisted > 0 && (
                      <span className="text-sky-300">
                        {" "}
                        · {jobCounts.shortlisted} {t("jobs.shortlisted", "shortlisted")}
                      </span>
                    )}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 mt-4">
                  <button
                    onClick={() => void openApplicants(job)}
                    aria-expanded={openReview === job.id}
                    className="px-3 py-1.5 rounded-lg bg-brand-600/90 hover:bg-brand-500 text-xs font-semibold transition"
                  >
                    {openReview === job.id
                      ? t("jobs.review.hideApplicants", "Hide applicants")
                      : t("jobs.review.reviewApplicants", "Review applicants")}{" "}
                    ({jobCounts.total})
                  </button>
                  <button
                    onClick={() => void toggleStatus(job)}
                    className="px-3 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-xs font-semibold transition"
                  >
                    {job.status === "open"
                      ? t("jobs.review.closeListing", "Close listing")
                      : t("jobs.review.reopenListing", "Reopen listing")}
                  </button>
                </div>

                {openReview === job.id && (
                  <div className="mt-4 border-t border-slate-700 pt-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div
                        className="flex gap-1.5"
                        role="tablist"
                        aria-label={t("jobs.review.filterLabel", "Applicant filter")}
                      >
                        {(["all", "shortlisted"] as const).map((value) => (
                          <button
                            key={value}
                            role="tab"
                            aria-selected={filter === value}
                            onClick={() => setFilter(value)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                              filter === value
                                ? "bg-slate-200 text-slate-900"
                                : "bg-slate-700/50 text-slate-300 hover:bg-slate-700"
                            }`}
                          >
                            {value === "all"
                              ? `${t("jobs.review.all", "All")} (${jobCounts.total})`
                              : `${t("jobs.shortlisted", "Shortlisted")} (${jobCounts.shortlisted})`}
                          </button>
                        ))}
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {t("jobs.review.sortedByFit", "Sorted by profile fit")}
                      </p>
                    </div>

                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      {t(
                        "jobs.review.fitNote",
                        "Fit compares only the trade, district and state the worker entered on their profile. It is not a rating of the worker — read the application before deciding.",
                      )}
                    </p>

                    {visible.length === 0 ? (
                      <p className="text-sm text-slate-500 py-4 text-center">
                        {filter === "shortlisted"
                          ? t("jobs.review.noShortlisted", "No shortlisted applicants yet.")
                          : t("jobs.review.noApplicants", "No applications yet.")}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {visible.map((a) => (
                          <div
                            key={a.id}
                            className={`rounded-xl border p-3.5 ${
                              a.shortlisted
                                ? "border-sky-500/40 bg-sky-500/5"
                                : "border-slate-700/70 bg-slate-900/50"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3 min-w-0">
                                <div className="h-9 w-9 shrink-0 rounded-full bg-slate-700 text-slate-100 grid place-items-center text-xs font-bold">
                                  {initials(a.worker.full_name)}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-slate-100 truncate">
                                    {a.worker.full_name ?? t("jobs.review.unnamedWorker", "Worker")}{" "}
                                    <span className="font-mono text-xs text-blue-400">
                                      {a.worker.worker_code}
                                    </span>
                                  </p>
                                  <p className="text-xs text-slate-400">
                                    {[
                                      a.worker.occupation
                                        ? t(
                                            occupationLabelKey(a.worker.occupation),
                                            a.worker.occupation.replace(/_/g, " "),
                                          )
                                        : null,
                                      a.worker.district,
                                      a.worker.state,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ") ||
                                      t("jobs.review.noProfileDetail", "No profile details")}
                                  </p>
                                </div>
                              </div>

                              <span
                                className={`shrink-0 px-2 py-0.5 rounded border text-[11px] font-semibold ${
                                  REVIEW_TONE[a.review.level] ?? REVIEW_TONE.possible
                                }`}
                              >
                                {t(`jobs.level.${a.review.level}`, a.review.level)} ·{" "}
                                {a.review.score}
                              </span>
                            </div>

                            <div className="mt-2.5 h-1.5 rounded-full bg-slate-700/60 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${BAR_TONE[a.review.level] ?? BAR_TONE.possible}`}
                                style={{ width: `${Math.min(100, Math.max(0, a.review.score))}%` }}
                              />
                            </div>

                            {a.review.reasons.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-2.5">
                                {a.review.reasons.map((reason) => (
                                  <span
                                    key={reason}
                                    className="px-1.5 py-0.5 rounded bg-slate-700/60 text-[10px] text-slate-300"
                                  >
                                    {t(`jobs.reasons.${reason}`, reason)}
                                  </span>
                                ))}
                              </div>
                            )}

                            {a.note && (
                              <p className="text-xs text-slate-300 mt-2 border-l-2 border-slate-600 pl-2">
                                “{a.note}”
                              </p>
                            )}

                            <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5">
                              {a.worker.contact_phone ? (
                                <span className="text-xs text-emerald-300">
                                  📞 {a.worker.contact_phone}{" "}
                                  <span className="text-slate-500">
                                    ({t("jobs.review.phoneShared", "shared by the worker")})
                                  </span>
                                </span>
                              ) : (
                                <span className="text-xs text-slate-500">
                                  {t(
                                    "jobs.review.phoneNotShared",
                                    "Phone not shared — contact them through this office",
                                  )}
                                </span>
                              )}

                              <button
                                onClick={() => void toggleShortlist(job, a)}
                                disabled={busyApplicant === a.id}
                                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition disabled:opacity-50 ${
                                  a.shortlisted
                                    ? "bg-slate-700/70 hover:bg-slate-700 text-slate-200"
                                    : "bg-sky-600/90 hover:bg-sky-500 text-white"
                                }`}
                              >
                                {a.shortlisted
                                  ? t("jobs.review.unshortlist", "Remove shortlist")
                                  : t("jobs.review.shortlist", "Shortlist")}
                              </button>
                            </div>

                            <p className="text-[10px] text-slate-500 mt-2">
                              {t(
                                "jobs.review.shortlistNote",
                                "Shortlisting only records that this office read the application. It is not an offer of work.",
                              )}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
