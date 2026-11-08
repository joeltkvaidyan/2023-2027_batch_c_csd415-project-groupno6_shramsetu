import { useCallback, useRef, useState } from "react";
import { Search } from "lucide-react";
import { api, apiErrorDetail } from "../../api/client";

/**
 * Government EMPLOYER acceptance queue. A new employer account starts
 * "pending"; the labour office inside its registered state/district (or a
 * superadmin, or any official for location-less accounts) accepts or rejects.
 * Acceptance is what unlocks a POSTING a job listing publicly and RATING
 * workers — mirroring the worker gate. Acceptance is NOT a business
 * certification: the honest notice below is shown to the official too.
 */

interface ApprovalEmployer {
  id: string;
  full_name: string;
  business_name: string | null;
  mobile_number: string;
  current_state: string | null;
  current_district: string | null;
  gov_approve_status: "pending" | "accepted" | "rejected";
  created_at: string;
}

interface EmployerQueueResponse {
  status: string;
  counts: { pending: number; accepted: number; rejected: number };
  employers: ApprovalEmployer[];
  notice?: string;
}

export default function EmployerApprovalsPanel() {
  const [status, setStatus] = useState<"pending" | "accepted" | "rejected">("pending");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<EmployerQueueResponse | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (whichStatus: string = status, whichSearch: string = search) => {
      setError(null);
      try {
        const params = new URLSearchParams({ status: whichStatus });
        if (whichSearch.trim()) params.set("search", whichSearch.trim());
        const res = await api.get<EmployerQueueResponse>(`/government/employer-approvals`, {
          params,
        });
        setData(res.data);
      } catch (err) {
        setError(apiErrorDetail(err) || "Could not load the employer acceptance queue.");
      }
    },
    [status, search],
  );

  const decide = async (label: string, id: string, next: "accepted" | "rejected") => {
    setBusyId(id);
    setError(null);
    try {
      await api.patch(`/government/employers/${id}/approval`, { status: next });
      await load(status, searchRef.current?.value ?? search);
    } catch (err) {
      setError(apiErrorDetail(err) || "Could not update the approval.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Status switch */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex bg-slate-800 rounded-xl p-1">
          {(["pending", "accepted", "rejected"] as const).map((s) => (
            <button
              key={s}
              onClick={() => {
                setStatus(s);
                void load(s, search);
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition ${
                status === s ? "bg-brand-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {s} {data ? `(${data.counts[s]})` : ""}
            </button>
          ))}
        </div>
        <input
          ref={searchRef}
          type="text"
          placeholder="Search by owner name, business or mobile…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          className="flex-1 min-w-[240px] bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          onClick={() => void load()}
          className="bg-brand-600 hover:bg-brand-700 px-4 py-2.5 rounded-xl font-medium transition active:scale-[0.98] flex items-center gap-1.5"
        >
          <Search className="h-4 w-4" aria-hidden="true" /> Search
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-xl p-3">
          {error}
        </p>
      )}

      {!data && !error && (
        <p className="text-slate-500 text-center py-8">Loading employer queue…</p>
      )}

      {data && data.employers.length === 0 && (
        <p className="text-slate-500 text-center py-8">
          No {status} employer accounts in your scope.
        </p>
      )}

      <div className="space-y-3">
        {data?.employers.map((e) => (
          <div
            key={e.id}
            className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 flex flex-wrap items-center gap-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    e.gov_approve_status === "pending"
                      ? "bg-amber-500/20 text-amber-400"
                      : e.gov_approve_status === "accepted"
                        ? "bg-green-500/20 text-green-400"
                        : "bg-red-500/20 text-red-400"
                  }`}
                >
                  {e.gov_approve_status}
                </span>
              </div>
              <p className="font-medium text-white mt-0.5">
                {e.business_name || "(no business name)"}
              </p>
              <p className="text-slate-400 text-xs mt-0.5">
                owner {e.full_name} • {e.current_district || "-"}, {e.current_state || "-"} • mobile{" "}
                {e.mobile_number}
              </p>
            </div>
            <div className="flex gap-2">
              {e.gov_approve_status !== "accepted" && (
                <button
                  disabled={busyId === e.id}
                  onClick={() => void decide(e.business_name || e.full_name, e.id, "accepted")}
                  className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition"
                >
                  Accept
                </button>
              )}
              {e.gov_approve_status !== "rejected" && (
                <button
                  disabled={busyId === e.id}
                  onClick={() => void decide(e.business_name || e.full_name, e.id, "rejected")}
                  className="bg-red-600/60 hover:bg-red-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition"
                >
                  Reject
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {data && (
        <p className="text-xs text-slate-500">
          {data.notice ||
            "Accepting an employer lets it post listings publicly and rate workers. Acceptance records that a labour office reviewed the account — it is not a business certification."}
        </p>
      )}
    </div>
  );
}
