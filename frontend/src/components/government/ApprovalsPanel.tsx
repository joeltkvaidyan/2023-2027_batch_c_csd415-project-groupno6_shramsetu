import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { api, apiErrorDetail } from "../../api/client";

/**
 * Government worker-acceptance queue. Every NEW worker registration lands
 * here as "pending"; an official inside the same jurisdiction accepts or
 * rejects. Acceptance is what lets a worker apply to jobs and appear in the
 * public find-a-worker directory — this panel is therefore the single gate to
 * the platform's public surfaces. Scoped server-side: outside-jurisdiction
 * workers are invisible here, exactly like the grievance queue.
 */

interface ApprovalWorker {
  id: string;
  worker_id: string;
  full_name: string;
  mobile_number: string;
  occupation: string | null;
  current_state: string | null;
  current_district: string | null;
  gov_approve_status: "pending" | "accepted" | "rejected";
  created_at: string;
}

interface QueueResponse {
  status: string;
  counts: { pending: number; accepted: number; rejected: number };
  workers: ApprovalWorker[];
}

export default function ApprovalsPanel() {
  const [status, setStatus] = useState<"pending" | "accepted" | "rejected">("pending");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<QueueResponse | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (whichStatus: string = status, whichSearch: string = search) => {
      setError(null);
      try {
        const params = new URLSearchParams({ status: whichStatus });
        if (whichSearch.trim()) params.set("search", whichSearch.trim());
        const res = await api.get<QueueResponse>(`/government/worker-approvals`, { params });
        setData(res.data);
      } catch (err) {
        setError(apiErrorDetail(err) || "Could not load the acceptance queue.");
      }
    },
    [status, search],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (workerId: string, id: string, next: "accepted" | "rejected") => {
    setBusyId(id);
    setError(null);
    try {
      await api.patch(`/government/workers/${id}/approval`, { status: next });
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
          placeholder="Search by name, worker ID or mobile…"
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

      {!data && !error && <p className="text-slate-500 text-center py-8">Loading queue…</p>}

      {data && data.workers.length === 0 && (
        <p className="text-slate-500 text-center py-8">
          No {status} registrations in your jurisdiction.
        </p>
      )}

      <div className="space-y-3">
        {data?.workers.map((w) => (
          <div
            key={w.id}
            className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 flex flex-wrap items-center gap-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-blue-400 text-sm">{w.worker_id}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    w.gov_approve_status === "pending"
                      ? "bg-amber-500/20 text-amber-400"
                      : w.gov_approve_status === "accepted"
                        ? "bg-green-500/20 text-green-400"
                        : "bg-red-500/20 text-red-400"
                  }`}
                >
                  {w.gov_approve_status}
                </span>
              </div>
              <p className="font-medium text-white mt-0.5">{w.full_name}</p>
              <p className="text-slate-400 text-xs mt-0.5">
                {w.occupation?.replace(/_/g, " ") || "trade not recorded"} •{" "}
                {w.current_district || "-"}, {w.current_state || "-"} • mobile {w.mobile_number}
              </p>
            </div>
            <div className="flex gap-2">
              {w.gov_approve_status !== "accepted" && (
                <button
                  disabled={busyId === w.id}
                  onClick={() => void decide(w.worker_id, w.id, "accepted")}
                  className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition"
                >
                  Accept
                </button>
              )}
              {w.gov_approve_status !== "rejected" && (
                <button
                  disabled={busyId === w.id}
                  onClick={() => void decide(w.worker_id, w.id, "rejected")}
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
          Acceptance is what lets a worker apply to job listings and appear in the public
          find-a-worker directory. Only workers inside your jurisdiction can be seen or decided
          here.
        </p>
      )}
    </div>
  );
}
