import { useCallback, useEffect, useState } from "react";
import {
  govCreateJob,
  govGetJobApplicants,
  govGetPostedJobs,
  govSetJobStatus,
  type GovJobApplicant,
  type GovJobPosting,
} from "../../api/governmentClient";
import { OCCUPATIONS } from "../register/constants";

/**
 * Government-side job listings.
 *
 * The office creates a listing inside its own jurisdiction (the server forces
 * state/district), sees how many workers applied, and can close it. Applicants
 * are shown with the worker code always, but a phone number only when the
 * worker explicitly shared it — the panel says so rather than implying the
 * office can always call.
 */
export default function JobsPanel({ token }: { token: string | null }) {
  const [jobs, setJobs] = useState<GovJobPosting[] | null>(null);
  const [applicants, setApplicants] = useState<Record<string, GovJobApplicant[]>>({});
  const [openApplicants, setOpenApplicants] = useState<string | null>(null);
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
      setError("Could not load your job listings.");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

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
      setShowForm(false);
      await load();
    } catch (err) {
      const status = (err as { response?: { status?: number; data?: { detail?: string } } })?.response;
      setError(
        status?.status === 403
          ? "That listing is outside your jurisdiction."
          : status?.data?.detail || "Could not create the listing."
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
      setError("Could not update the listing.");
    }
  };

  const viewApplicants = async (job: GovJobPosting) => {
    if (!token) return;
    if (openApplicants === job.id) {
      setOpenApplicants(null);
      return;
    }
    try {
      const res = await govGetJobApplicants(token, job.id);
      setApplicants((prev) => ({ ...prev, [job.id]: res.applications }));
      setOpenApplicants(job.id);
    } catch {
      setError("Could not load applicants.");
    }
  };

  const field =
    "w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">🧰 Job Listings</h2>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-sm font-semibold transition"
        >
          {showForm ? "Cancel" : "+ New listing"}
        </button>
      </div>

      <p className="text-sm text-slate-400">
        Listings are scoped to your jurisdiction and marked <strong>unverified</strong> for workers: ShramSetu
        cannot confirm that an employer will honour the stated wage.
      </p>

      {error && (
        <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
      )}

      {showForm && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-5 space-y-3">
          <input
            className={field}
            placeholder="Job title (e.g. Mason required for apartment site)"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <textarea
            className={`${field} resize-none`}
            rows={3}
            placeholder="Description: work, site, wage payment schedule, working hours"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <input
            className={field}
            placeholder="Employer / contractor name"
            value={form.employer_name}
            onChange={(e) => setForm({ ...form, employer_name: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <select
              className={field}
              value={form.occupation}
              onChange={(e) => setForm({ ...form, occupation: e.target.value })}
            >
              <option value="any">Any trade</option>
              {OCCUPATIONS.map((code) => (
                <option key={code} value={code}>
                  {code.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <input
              className={field}
              placeholder="District (within your jurisdiction)"
              value={form.district}
              onChange={(e) => setForm({ ...form, district: e.target.value })}
            />
            <input
              className={field}
              placeholder="Wage from (₹)"
              value={form.wage_min}
              onChange={(e) => setForm({ ...form, wage_min: e.target.value })}
            />
            <input
              className={field}
              placeholder="Wage to (₹)"
              value={form.wage_max}
              onChange={(e) => setForm({ ...form, wage_max: e.target.value })}
            />
            <input
              className={field}
              placeholder="Openings"
              value={form.openings}
              onChange={(e) => setForm({ ...form, openings: e.target.value })}
            />
            <input
              className={field}
              placeholder="Site / location"
              value={form.work_location}
              onChange={(e) => setForm({ ...form, work_location: e.target.value })}
            />
          </div>
          <input
            className={field}
            placeholder="Contact phone (optional — leave blank if unknown)"
            value={form.contact_phone}
            onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
          />
          <button
            onClick={() => void create()}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-sm font-semibold"
          >
            {saving ? "Creating…" : "Publish listing"}
          </button>
        </div>
      )}

      {jobs === null ? (
        <p className="text-slate-500 text-center py-8">Loading listings…</p>
      ) : jobs.length === 0 ? (
        <p className="text-slate-500 text-center py-8">No listings posted yet.</p>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div key={job.id} className="bg-slate-800/50 border border-slate-700 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{job.title}</h3>
                  <p className="text-sm text-slate-400">
                    {job.employer_name} · {[job.district, job.state].filter(Boolean).join(", ")}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {job.occupation.replace(/_/g, " ")} · {job.openings} opening(s)
                    {job.wage_max !== null && ` · ₹${job.wage_min ?? job.wage_max}–${job.wage_max}/${job.wage_period}`}
                  </p>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-xs ${
                    job.status === "open" ? "bg-green-500/20 text-green-400" : "bg-slate-600/40 text-slate-300"
                  }`}
                >
                  {job.status}
                </span>
              </div>

              <div className="flex flex-wrap gap-2 mt-4">
                <button
                  onClick={() => void viewApplicants(job)}
                  className="px-3 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-xs font-semibold"
                >
                  {openApplicants === job.id ? "Hide applicants" : `Applicants (${job.applications_count})`}
                </button>
                <button
                  onClick={() => void toggleStatus(job)}
                  className="px-3 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-xs font-semibold"
                >
                  {job.status === "open" ? "Close listing" : "Reopen listing"}
                </button>
              </div>

              {openApplicants === job.id && (
                <div className="mt-4 space-y-2">
                  {(applicants[job.id] ?? []).length === 0 ? (
                    <p className="text-sm text-slate-500">No applications yet.</p>
                  ) : (
                    (applicants[job.id] ?? []).map((a) => (
                      <div key={a.id} className="bg-slate-900/50 rounded-xl p-3 text-sm">
                        <p className="font-medium">
                          {a.worker.full_name} <span className="font-mono text-blue-400">{a.worker.worker_code}</span>
                        </p>
                        <p className="text-xs text-slate-400">
                          {[a.worker.occupation?.replace(/_/g, " "), a.worker.district, a.worker.state]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        <p className="text-xs mt-1">
                          {a.worker.contact_phone ? (
                            <span className="text-emerald-400">📞 {a.worker.contact_phone}</span>
                          ) : (
                            <span className="text-slate-500">Phone not shared by the worker</span>
                          )}
                        </p>
                        {a.note && <p className="text-xs text-slate-300 mt-1">“{a.note}”</p>}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
