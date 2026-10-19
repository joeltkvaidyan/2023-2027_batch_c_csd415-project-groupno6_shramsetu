import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Briefcase, CheckCircle2, MapPin, Phone, Search, Users } from "lucide-react";
import { Screen } from "../components/Screen";
import { Card, Badge, SkeletonList } from "../components/ui";
import { Button } from "../components/ui/Button";
import { api, apiErrorMessage } from "../api/client";
import { OCCUPATIONS, occupationLabelKey } from "../components/register/constants";
import type { JobApplication, JobMatch, JobMatchLevel } from "../types";

/**
 * Job matches posted by government/partner officials inside their jurisdiction.
 *
 * The screen is explicit about two limits: the match score is guidance derived
 * from the worker's own profile (not a recommendation or a job guarantee), and
 * every listing is unverified by ShramSetu — so it repeats the "never pay a
 * fee" warning and links to the scam checker.
 *
 * "Shortlisted" is shown as "the office read your application", never as an
 * offer: no status a worker sees here can promise work.
 */
const LEVEL_TONE: Record<JobMatchLevel, "success" | "info" | "neutral"> = {
  strong: "success",
  good: "info",
  possible: "neutral",
};

const LEVEL_BAR: Record<JobMatchLevel, string> = {
  strong: "bg-emerald-500",
  good: "bg-sky-500",
  possible: "bg-gray-400",
};

export default function JobsPage() {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<JobMatch[] | null>(null);
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [occupation, setOccupation] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [error, setError] = useState("");
  const [busyJobId, setBusyJobId] = useState<string | null>(null);

  // Typing should not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (occupation) params.occupation = occupation;
      if (debouncedQuery.trim()) params.q = debouncedQuery.trim();

      const [jobsRes, appsRes] = await Promise.all([
        api.get<{ jobs: JobMatch[] }>("/jobs", { params }),
        api.get<{ applications: JobApplication[] }>("/jobs/applications/mine"),
      ]);
      setJobs(jobsRes.data.jobs);
      setApplications(appsRes.data.applications);
      setError("");
    } catch (err) {
      setJobs([]);
      setError(apiErrorMessage(err, t("common.error")));
    }
  }, [occupation, debouncedQuery, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = async (job: JobMatch, shareContact: boolean) => {
    setBusyJobId(job.id);
    try {
      await api.post(`/jobs/${job.id}/apply`, { share_contact: shareContact });
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, t("common.error")));
    } finally {
      setBusyJobId(null);
    }
  };

  const withdraw = async (job: JobMatch) => {
    setBusyJobId(job.id);
    try {
      await api.delete(`/jobs/${job.id}/apply`);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, t("common.error")));
    } finally {
      setBusyJobId(null);
    }
  };

  const shortlistedCount = useMemo(
    () => applications.filter((a) => a.status === "shortlisted").length,
    [applications]
  );

  return (
    <Screen title={t("jobs.title", "Job matches")} onBack={true}>
      <div className="space-y-4 mt-4 pb-10">
        <Card className="!p-4 bg-amber-50 dark:bg-amber-900/20 border-amber-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-900 dark:text-amber-100">
              {t(
                "jobs.disclaimer",
                "Listings are published by labour offices on ShramSetu. ShramSetu does not verify the employer or the wage. Never pay a fee to get a job."
              )}
            </p>
          </div>
        </Card>

        <Card className="!p-3">
          <div className="flex items-center gap-2 mb-2">
            <Search className="h-4 w-4 text-gray-400" />
            <input
              className="input-field"
              placeholder={t("jobs.searchPlaceholder", "Search by work or place")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t("jobs.searchPlaceholder", "Search by work or place")}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setOccupation("")} className="cursor-pointer">
              <Badge tone={occupation === "" ? "brand" : "neutral"}>{t("jobs.allTrades", "All trades")}</Badge>
            </button>
            {OCCUPATIONS.map((code) => (
              <button key={code} type="button" onClick={() => setOccupation(code)} className="cursor-pointer">
                <Badge tone={occupation === code ? "brand" : "neutral"}>
                  {t(occupationLabelKey(code), code)}
                </Badge>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            {jobs === null
              ? t("jobs.loadingMatches", "Finding listings near your profile…")
              : t("jobs.resultsCount", {
                  count: jobs.length,
                  defaultValue: "{{count}} listing(s) match your profile",
                })}
          </p>
        </Card>

        {error && (
          <Card className="!p-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </Card>
        )}

        {applications.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                {t("jobs.myApplications", "My applications")}
              </h2>
              {shortlistedCount > 0 && (
                <span className="text-[11px] text-sky-600 dark:text-sky-300">
                  {t("jobs.shortlistedCount", {
                    count: shortlistedCount,
                    defaultValue: "{{count}} shortlisted by the office",
                  })}
                </span>
              )}
            </div>
            {applications.map((a) => (
              <Card key={a.id} className="!p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {a.job?.title ?? t("jobs.listingUnavailable", "Listing no longer available")}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {t("jobs.appliedOn", "Applied on")} {new Date(a.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  {a.status === "shortlisted" && (
                    <Badge tone="info">{t("jobs.shortlisted", "Shortlisted")}</Badge>
                  )}
                </div>
                {a.status === "shortlisted" && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5">
                    {t(
                      "jobs.shortlistedNote",
                      "The office read your application. This is not an offer of work — keep applying."
                    )}
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}

        {jobs === null ? (
          <SkeletonList rows={3} />
        ) : jobs.length === 0 ? (
          <Card className="text-center py-8">
            <Briefcase className="h-8 w-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("jobs.empty", "No job matches right now. New listings from your district will appear here.")}
            </p>
            {(occupation || query) && (
              <button
                type="button"
                onClick={() => {
                  setOccupation("");
                  setQuery("");
                }}
                className="mt-3 text-xs font-semibold text-brand-600 dark:text-brand-300 underline cursor-pointer"
              >
                {t("jobs.clearFilters", "Clear search and trade filter")}
              </button>
            )}
          </Card>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <Card key={job.id} className="!p-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex-1">{job.title}</h3>
                  <Badge tone={LEVEL_TONE[job.match.level]}>
                    {t(`jobs.level.${job.match.level}`, job.match.level)}
                  </Badge>
                </div>

                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${LEVEL_BAR[job.match.level]}`}
                      style={{ width: `${Math.min(100, Math.max(0, job.match.score))}%` }}
                      role="meter"
                      aria-valuenow={job.match.score}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={t("jobs.matchScore", "Profile fit")}
                    />
                  </div>
                  <span className="text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                    {job.match.score}/100
                  </span>
                </div>

                <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{job.employer_name}</p>

                <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 space-y-1">
                  <p className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {[job.work_location, job.district, job.state].filter(Boolean).join(", ")}
                  </p>
                  {job.wage_max !== null && (
                    <p>
                      {t("jobs.wageRange", "Stated wage")}: ₹{job.wage_min ?? job.wage_max}–{job.wage_max}{" "}
                      {t(`jobs.period.${job.wage_period}`, job.wage_period)}
                    </p>
                  )}
                  <p className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {t("jobs.openings", "Openings")}: {job.openings}
                    {job.posted_by_department && <span className="ml-1">· {job.posted_by_department}</span>}
                  </p>
                </div>

                <p className="text-sm text-gray-700 dark:text-gray-300 mt-3">{job.description}</p>

                <div className="flex flex-wrap gap-1.5 mt-3">
                  {job.match.reasons.map((reason) => (
                    <Badge key={reason} tone="neutral">
                      {t(`jobs.reasons.${reason}`, reason)}
                    </Badge>
                  ))}
                </div>

                {job.contact_phone && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5" />
                    {job.contact_phone}
                  </p>
                )}

                <p className="text-[11px] text-gray-400 mt-3">
                  {t(
                    "jobs.unverifiedNote",
                    "ShramSetu has not verified this employer or the wage. Confirm the terms in writing before starting work."
                  )}
                </p>

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {job.applied ? (
                    <>
                      {job.application_status === "shortlisted" ? (
                        <Badge tone="info">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          {t("jobs.shortlisted", "Shortlisted")}
                        </Badge>
                      ) : (
                        <Badge tone="success">{t("jobs.applied", "Applied")}</Badge>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyJobId === job.id}
                        onClick={() => void withdraw(job)}
                      >
                        {t("jobs.withdraw", "Withdraw")}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        disabled={busyJobId === job.id}
                        onClick={() => void apply(job, false)}
                      >
                        {t("jobs.apply", "I am interested")}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyJobId === job.id}
                        onClick={() => void apply(job, true)}
                      >
                        {t("jobs.applyShareContact", "Interested + share my number")}
                      </Button>
                    </>
                  )}
                </div>

                {job.application_status === "shortlisted" && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
                    {t(
                      "jobs.shortlistedNote",
                      "The office read your application. This is not an offer of work — keep applying."
                    )}
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </Screen>
  );
}
