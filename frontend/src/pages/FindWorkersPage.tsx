import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, Search, Star } from "lucide-react";
import { Screen } from "../components/Screen";
import { api, apiErrorMessage } from "../api/client";
import type { PublicWorker, PublicWorkersResponse } from "../types";

/**
 * Public "find a worker" directory — for people who are NOT on the platform
 * ("common people"). Search government-accepted workers by NAME or PLACE,
 * approach them directly for work, and rate the ones you hired with just a
 * name + mobile number (one rating per person per worker). Phone numbers,
 * documents and addresses of workers are never shown here — that is a
 * deliberate, server-enforced privacy boundary.
 */
export default function FindWorkersPage() {
  const [workers, setWorkers] = useState<PublicWorker[] | null>(null);
  const [ occupations, setOccupations ] = useState<string[]>([]);
  const [occupation, setOccupation] = useState("");
  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  const [error, setError] = useState("");

  // Rating form state (one worker open at a time).
  const [ratingWorkerId, setRatingWorkerId] = useState<string | null>(null);
  const [raterName, setRaterName] = useState("");
  const [raterPhone, setRaterPhone] = useState("");
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState("");
  const [formError, setFormError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ occupations: string[] }>("/public/occupations")
      .then((res) => setOccupations(res.data.occupations))
      .catch(() => setOccupations([]));
  }, []);

  const load = useCallback(
    async (q: Record<string, string> = {}) => {
      setError("");
      try {
        const params = Object.fromEntries(
          Object.entries({ name, place, occupation, ...q }).filter(([, v]) => v)
        );
        const res = await api.get<PublicWorkersResponse>("/public/workers", { params });
        setWorkers(res.data.workers);
      } catch (err) {
        setWorkers([]);
        setError(apiErrorMessage(err));
      }
    },
    [name, place, occupation]
  );

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rate = async (worker: PublicWorker) => {
    setBusyId(worker.id);
    setFormError("");
    try {
      await api.post(`/ratings/worker/${worker.id}`, {
        stars,
        comment,
        rater_name: raterName,
        rater_phone: raterPhone,
      });
      setNote(`Thanks — your rating for ${worker.full_name} was saved.`);
      setRatingWorkerId(null);
      setComment("");
      await load();
    } catch (err: any) {
      setFormError(err?.response?.data?.detail || "Could not save the rating.");
    } finally {
      setBusyId(null);
    }
  };

  const openRate = (worker: PublicWorker) => {
    if (ratingWorkerId === worker.id) return setRatingWorkerId(null);
    setRatingWorkerId(worker.id);
    setStars(5);
    setComment("");
    setFormError("");
  };

  return (
    <Screen title="Find a Worker" onBack={true}>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Search government-approved workers by name, place or trade and approach
        them directly for work. Only names, trades and places are shown —
        ShramSetu never publishes phone numbers here.
      </p>

      <div className="flex gap-2 mb-4 flex-wrap">
        <input
          className="input-field flex-1 min-w-[140px]"
          placeholder="Name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Search by name"
        />
        <input
          className="input-field flex-1 min-w-[140px]"
          placeholder="Place (district / state / town)…"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          aria-label="Search by place"
        />
        <select
          className="input-field w-auto self-stretch"
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
        <button onClick={() => void load()} className="btn-primary px-5 flex items-center gap-2" type="button">
          <Search className="h-4 w-4" aria-hidden="true" /> Find
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {note && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 mb-3" role="status">
          {note}
        </p>
      )}

      {workers === null ? (
        <div className="flex items-center justify-center py-14">
          <Loader2 className="h-7 w-7 animate-spin text-brand-600" aria-label="Loading" />
        </div>
      ) : workers.length === 0 ? (
        <p className="text-center text-gray-400 py-12">No workers match that search yet.</p>
      ) : (
        <div className="space-y-3">
          {workers.map((w) => (
            <div key={w.id} className="card">
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 dark:text-gray-100">{w.full_name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {w.occupation ? w.occupation.replace(/_/g, " ") : "trade not recorded"}
                    {w.years_of_experience != null ? ` • ${w.years_of_experience} yrs experience` : ""} • {w.place || "place not recorded"}
                  </p>
                  <p className="text-xs mt-1.5 text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-amber-500 dark:fill-amber-400" aria-hidden="true" />
                    {w.rating.average != null ? `${w.rating.average} (${w.rating.count} ratings)` : "No ratings yet"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300">
                    ✓ gov approved
                  </span>
                  <button onClick={() => openRate(w)} className="btn-secondary text-xs px-3 py-2" type="button">
                    {ratingWorkerId === w.id ? "Close" : "Rate"}
                  </button>
                </div>
              </div>

              {ratingWorkerId === w.id && (
                <div className="mt-3 border-t border-gray-200 dark:border-gray-700 pt-3 space-y-2" data-testid={`rate-form-${w.id}`}>
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => setStars(n)}
                        aria-label={`${n} star${n > 1 ? "s" : ""}`}
                        type="button"
                        className={`text-2xl ${n <= stars ? "text-amber-500" : "text-gray-300 dark:text-gray-600"}`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                  <input
                    className="input-field"
                    placeholder="Your name"
                    value={raterName}
                    onChange={(e) => setRaterName(e.target.value.slice(0, 80))}
                  />
                  <input
                    className="input-field"
                    inputMode="numeric"
                    placeholder="Your mobile number (keeps ratings one-per-person)"
                    value={raterPhone}
                    onChange={(e) => setRaterPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  />
                  <textarea
                    className="input-field"
                    rows={2}
                    placeholder="Comment (optional)…"
                    value={comment}
                    onChange={(e) => setComment(e.target.value.slice(0, 300))}
                  />
                  {formError && (
                    <p className="text-red-600 dark:text-red-400 text-xs flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {formError}
                    </p>
                  )}
                  <button
                    onClick={() => void rate(w)}
                    disabled={busyId === w.id}
                    className="btn-primary w-full"
                    type="button"
                  >
                    {busyId === w.id ? "Saving…" : "Submit rating"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500 mt-6">
        Ratings are honest community feedback, not verification — ShramSetu
        cannot check that the rater actually hired the worker. Use your own
        judgement before agreeing to any payment.
      </p>
    </Screen>
  );
}
