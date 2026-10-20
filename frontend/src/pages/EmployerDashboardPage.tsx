import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Loader2, LogOut, Search, Star } from "lucide-react";
import { employerApi, clearEmployerToken } from "../api/client";
import { apiErrorMessage } from "../api/client";
import type { PublicWorker, PublicWorkersResponse } from "../types";

/**
 * Employer dashboard: browse government-accepted workers (the same
 * privacy-safe directory the public sees) and rate the ones they hired.
 * One rating per employer per worker; re-rating edits the existing rating.
 */
export default function EmployerDashboardPage() {
  const navigate = useNavigate();
  const [workers, setWorkers] = useState<PublicWorker[] | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Per-worker rating draft state.
  const [ratingWorkerId, setRatingWorkerId] = useState<string | null>(null);
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState("");
  const [employerName, setEmployerName] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!localStorage.getItem("employer_token")) navigate("/employer/login", { replace: true });
  }, [navigate]);

  const load = useCallback(
    async (q: Record<string, string> = {}) => {
      setError("");
      try {
        // The directory endpoint is public; with the employer token attached
        // it simply means the session is signed in for rating actions.
        const res = await employerApi.get<PublicWorkersResponse>("/public/workers", {
          params: Object.fromEntries(Object.entries({ name, place, ...q }).filter(([, v]) => v)),
        });
        setWorkers(res.data.workers);
      } catch (err) {
        setWorkers([]);
        setError(apiErrorMessage(err));
      }
    },
    [name, place]
  );

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rate = async (worker: PublicWorker) => {
    setBusyId(worker.id);
    setFormError("");
    try {
      await employerApi.post(`/ratings/worker/${worker.id}`, { stars, comment, employer_name: employerName });
      setNote(`Rated ${worker.full_name}: ${stars}★`);
      setRatingWorkerId(null);
      setComment("");
      await load();
    } catch (err: any) {
      setFormError(err?.response?.data?.detail || "Could not save the rating.");
    } finally {
      setBusyId(null);
    }
  };

  const logout = () => {
    clearEmployerToken();
    localStorage.removeItem("employer_user");
    navigate("/employer/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="glass bg-slate-900/80 border-b border-slate-800 px-4 py-3 sticky top-0 z-20">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-sky-500 to-blue-600 rounded-xl flex items-center justify-center ring-1 ring-white/10">
              🏢
            </div>
            <div>
              <h1 className="font-bold">Employer Portal</h1>
              <p className="text-xs text-slate-400">
                {(() => {
                  try {
                    return JSON.parse(localStorage.getItem("employer_user") || "{}").full_name || "";
                  } catch {
                    return "";
                  }
                })()}
              </p>
            </div>
          </div>
          <button onClick={logout} className="text-slate-400 hover:text-white flex items-center gap-1.5 text-sm">
            <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 space-y-4">
        <p className="text-slate-400 text-sm">
          Every worker below was registered and accepted by a government labour
          office. Search by NAME or PLACE, approach them directly for work, and
          rate the ones you hired — community and employer ratings help other
          people find reliable workers.
        </p>

        <div className="flex gap-3 flex-wrap">
          <input
            className="flex-1 min-w-[180px] bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Worker name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="flex-1 min-w-[180px] bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Place (district / state / town)…"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
          />
          <button
            onClick={() => void load()}
            className="bg-brand-600 hover:bg-brand-700 px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 active:scale-[0.98] transition"
          >
            <Search className="h-4 w-4" aria-hidden="true" /> Find
          </button>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}
        {note && <p className="text-emerald-400 text-sm">{note}</p>}

        {workers === null ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-brand-500" aria-label="Loading" />
          </div>
        ) : workers.length === 0 ? (
          <p className="text-slate-500 text-center py-10">No workers match that search.</p>
        ) : (
          <div className="space-y-3">
            {workers.map((w) => (
              <div key={w.id} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white">{w.full_name}</p>
                    <p className="text-slate-400 text-xs mt-0.5">
                      {w.occupation?.replace(/_/g, " ") || "trade not recorded"}
                      {w.years_of_experience != null ? ` • ${w.years_of_experience} yrs` : ""} • {w.place || "place not recorded"}
                    </p>
                    <p className="text-xs mt-1 text-amber-400 flex items-center gap-1">
                      <Star className="h-3.5 w-3.5 fill-amber-400" aria-hidden="true" />
                      {w.rating.average != null ? `${w.rating.average} (${w.rating.count} ratings)` : "No ratings yet"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-1 rounded-full text-xs bg-green-500/20 text-green-400 font-medium">
                      gov approved
                    </span>
                    <button
                      onClick={() => {
                        if (ratingWorkerId === w.id) {
                          setRatingWorkerId(null);
                        } else {
                          setRatingWorkerId(w.id);
                          setStars(5);
                          setComment("");
                          setFormError("");
                        }
                      }}
                      className="bg-sky-600 hover:bg-sky-700 text-white text-sm px-4 py-2 rounded-lg transition flex items-center gap-1.5"
                    >
                      <Star className="h-4 w-4" aria-hidden="true" /> {ratingWorkerId === w.id ? "Close" : "Rate"}
                    </button>
                  </div>
                </div>

                {ratingWorkerId === w.id && (
                  <div className="mt-3 border-t border-slate-700 pt-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Stars:</span>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          onClick={() => setStars(n)}
                          aria-label={`${n} star${n > 1 ? "s" : ""}`}
                          className={`text-xl ${n <= stars ? "text-amber-400" : "text-slate-600"}`}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                    <input
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder="Your business / site name (optional)"
                      value={employerName}
                      onChange={(e) => setEmployerName(e.target.value.slice(0, 120))}
                    />
                    <textarea
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder="Comment (optional, max 300 chars)…"
                      rows={2}
                      value={comment}
                      onChange={(e) => setComment(e.target.value.slice(0, 300))}
                    />
                    {formError && <p className="text-red-400 text-xs flex items-center gap-1"><AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> {formError}</p>}
                    <button
                      onClick={() => void rate(w)}
                      disabled={busyId === w.id}
                      className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition"
                    >
                      {busyId === w.id ? "Saving…" : "Save rating"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-slate-500">
          Ratings are signed with your employer account and shown publicly with
          your business name. They are community feedback, not a credential.
        </p>
      </main>
    </div>
  );
}
