import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Search, Users, UserCheck, Megaphone, Flag } from "lucide-react";
import { getGovToken, clearGovToken } from "../api/client";
import NotificationsPanel from "../components/government/NotificationsPanel";
import JobsPanel from "../components/government/JobsPanel";
import ApprovalsPanel from "../components/government/ApprovalsPanel";
import {
  govGetStats,
  govGetWorkers,
  govGetGrievances,
  govUpdateGrievanceStatus,
  govGetNotifications,
  govGetOfficials,
  govGetAuditLogs,
  type GovernmentOfficial,
  type DashboardStats,
  type WorkerRecord,
  type GovGrievance,
  type GovNotification,
  type AuditLog,
} from "../api/governmentClient";

type Tab = "overview" | "approvals" | "grievances" | "workers" | "jobs" | "notifications" | "officials" | "audit";

export default function GovernmentDashboardPage() {
  const navigate = useNavigate();
  const token = getGovToken();
  const govUser = JSON.parse(localStorage.getItem("gov_user") || "{}");

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [workers, setWorkers] = useState<WorkerRecord[]>([]);
  const [grievances, setGrievances] = useState<GovGrievance[]>([]);
  const [notifications, setNotifications] = useState<GovNotification[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [officials, setOfficials] = useState<GovernmentOfficial[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [grievanceStatusFilter, setGrievanceStatusFilter] = useState("");
  const [grievanceCategoryFilter, setGrievanceCategoryFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      navigate("/government/login");
      return;
    }
    loadTabData();
  }, [activeTab, token]);

  const loadTabData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      if (activeTab === "overview") {
        setStats(await govGetStats(token));
      } else if (activeTab === "workers") {
        const res = await govGetWorkers(token, searchQuery || undefined);
        setWorkers(res.workers || []);
      } else if (activeTab === "grievances") {
        const res = await govGetGrievances(
          token,
          grievanceStatusFilter || undefined,
          grievanceCategoryFilter || undefined
        );
        setGrievances(res.grievances || []);
      } else if (activeTab === "notifications") {
        const res = await govGetNotifications(token);
        setNotifications(res.notifications || []);
      } else if (activeTab === "officials") {
        const res = await govGetOfficials(token);
        setOfficials(res.officials || []);
      } else if (activeTab === "audit") {
        const res = await govGetAuditLogs(token);
        setAuditLogs(res.logs || []);
      }
    } catch (err: any) {
      console.error("Failed to load:", err);
      if (err?.response?.status === 401) {
        clearGovToken();
        localStorage.removeItem("gov_user");
        navigate("/government/login");
      }
    } finally {
      setLoading(false);
    }
  }, [activeTab, token, searchQuery, grievanceStatusFilter, grievanceCategoryFilter]);

  const handleUpdateGrievanceStatus = async (id: number, newStatus: string) => {
    if (!token) return;
    try {
      await govUpdateGrievanceStatus(token, id, newStatus);
      loadTabData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleLogout = () => {
    clearGovToken();
    localStorage.removeItem("gov_user");
    navigate("/government/login");
  };

  const tabs: { key: Tab; icon: string; label: string }[] = [
    { key: "overview", icon: "📊", label: "Overview" },
    { key: "approvals", icon: "✅", label: "Approvals" },
    { key: "grievances", icon: "📢", label: "Grievances" },
    { key: "workers", icon: "👷", label: "Workers" },
    { key: "jobs", icon: "🧰", label: "Job Listings" },
    { key: "notifications", icon: "🔔", label: "Notifications" },
    // Officials monitoring is superadmin-only — hidden here and 403-guarded
    // server-side, so ordinary state/district officials never see the tab.
    ...(govUser.is_superadmin
      ? [{ key: "officials" as Tab, icon: "👥", label: "Officials" }]
      : []),
    { key: "audit", icon: "📋", label: "Audit Logs" },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="glass bg-slate-900/80 border-b border-slate-800 px-4 py-3 sticky top-0 z-20">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-brand-500 to-teal-600 rounded-xl flex items-center justify-center shadow-glow-brand ring-1 ring-white/10">
              <span className="text-xl">🛡️</span>
            </div>
            <div>
              <h1 className="font-bold text-lg">ShramSetu Government Portal</h1>
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <span>{govUser.is_superadmin ? "Super Admin" : govUser.department || "Official"}</span>
                <span>•</span>
                <span>{govUser.employee_id}</span>
                {govUser.state && (
                  <>
                    <span>•</span>
                    <span>{govUser.state}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white transition p-2 rounded-lg hover:bg-slate-800 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" /> Sign Out
          </button>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="bg-slate-900/50 border-b border-slate-800 overflow-x-auto">
        <div className="flex gap-1 max-w-7xl mx-auto px-4">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition border-b-2 ${
                activeTab === tab.key
                  ? "border-brand-400 text-brand-400"
                  : "border-transparent text-slate-400 hover:text-white"
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-7xl mx-auto p-4">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-brand-500/30 border-t-brand-400 rounded-full animate-spin" aria-label="Loading" />
          </div>
        )}

        {!loading && activeTab === "overview" && stats && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon={Users} label="Total Workers" value={stats.total_workers} color="blue" />
              <StatCard icon={UserCheck} label="Active Workers" value={stats.active_workers} color="green" />
              <StatCard icon={Megaphone} label="Open Grievances" value={stats.open_grievances} color="amber" />
              <StatCard icon={Flag} label="Resolved" value={stats.resolved_grievances} color="emerald" />
            </div>

            {/* Grievances by Category */}
            {stats.grievances_by_category && Object.keys(stats.grievances_by_category).length > 0 && (
              <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6">
                <h3 className="font-bold mb-4">📊 Grievances by Category</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {Object.entries(stats.grievances_by_category).map(([cat, count]) => (
                    <div key={cat} className="bg-slate-900/50 rounded-xl p-3">
                      <p className="text-2xl font-bold text-blue-400">{count}</p>
                      <p className="text-slate-400 text-sm capitalize">{cat.replace(/_/g, " ")}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Workers by State */}
            {stats.workers_by_state && Object.keys(stats.workers_by_state).length > 0 && (
              <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6">
                <h3 className="font-bold mb-4">🗺️ Workers by State</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Object.entries(stats.workers_by_state).map(([state, count]) => (
                    <div key={state} className="bg-slate-900/50 rounded-xl p-3">
                      <p className="text-2xl font-bold text-emerald-400">{count}</p>
                      <p className="text-slate-400 text-sm">{state}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Filings */}
            {stats.recent_filings && stats.recent_filings.length > 0 && (
              <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6">
                <h3 className="font-bold mb-4">📋 Recent Grievance Filings</h3>
                <div className="space-y-2">
                  {stats.recent_filings.map((f) => (
                    <div key={f.id} className="flex items-center justify-between bg-slate-900/50 rounded-lg p-3">
                      <div>
                        <span className="font-mono text-blue-400 text-sm">{f.complaint_number}</span>
                        <span className="mx-2 text-slate-600">•</span>
                        <span className="text-white text-sm">{f.subject}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        f.status === "submitted" ? "bg-blue-500/20 text-blue-400" :
                        f.status === "under_review" ? "bg-amber-500/20 text-amber-400" :
                        f.status === "resolved" ? "bg-green-500/20 text-green-400" :
                        "bg-slate-500/20 text-slate-400"
                      }`}>
                        {f.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Approvals Tab ───────────────────────────────────── */}
        {!loading && activeTab === "approvals" && token && <ApprovalsPanel token={token} />}
        {!loading && activeTab === "workers" && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Search workers by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadTabData()}
                className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <button
                onClick={loadTabData}
                className="bg-brand-600 hover:bg-brand-700 px-4 py-2.5 rounded-xl font-medium transition active:scale-[0.98] flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <Search className="h-4 w-4" aria-hidden="true" /> Search
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400">
                    <th className="text-left py-3 px-3">Worker ID</th>
                    <th className="text-left py-3 px-3">Name</th>
                    <th className="text-left py-3 px-3">Occupation</th>
                    <th className="text-left py-3 px-3">State</th>
                    <th className="text-left py-3 px-3">District</th>
                    <th className="text-left py-3 px-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {workers.map((w) => (
                    <tr key={w.id} className="border-b border-slate-800 hover:bg-slate-800/50 transition">
                      <td className="py-3 px-3 font-mono text-blue-400">{w.worker_id}</td>
                      <td className="py-3 px-3">{w.full_name}</td>
                      <td className="py-3 px-3 text-slate-300">{w.occupation || "-"}</td>
                      <td className="py-3 px-3 text-slate-300">{w.current_state || "-"}</td>
                      <td className="py-3 px-3 text-slate-300">{w.current_district || "-"}</td>
                      <td className="py-3 px-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          w.is_active ? "bg-green-500/20 text-green-400" : "bg-slate-500/20 text-slate-400"
                        }`}>
                          {w.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {workers.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">No workers found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Grievances Tab ────────────────────────────────── */}
        {!loading && activeTab === "grievances" && (
          <div className="space-y-4">
            <div className="flex gap-3 flex-wrap">
              <select
                value={grievanceStatusFilter}
                onChange={(e) => setGrievanceStatusFilter(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">All Statuses</option>
                <option value="submitted">Submitted</option>
                <option value="under_review">Under Review</option>
                <option value="resolved">Resolved</option>
                <option value="rejected">Rejected</option>
              </select>
              <select
                value={grievanceCategoryFilter}
                onChange={(e) => setGrievanceCategoryFilter(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">All Categories</option>
                <option value="unpaid_wages">Unpaid Wages</option>
                <option value="workplace_safety">Workplace Safety</option>
                <option value="harassment_abuse">Harassment</option>
                <option value="illegal_termination">Illegal Termination</option>
                <option value="document_issue">Document Issue</option>
                <option value="employer_dispute">Employer Dispute</option>
                <option value="insurance_claim">Insurance Claim</option>
                <option value="accommodation">Accommodation</option>
                <option value="other">Other</option>
              </select>
              <button
                onClick={loadTabData}
                className="bg-blue-600 hover:bg-blue-700 px-4 py-2.5 rounded-xl font-medium transition"
              >
                Apply Filters
              </button>
            </div>
            {grievances.length === 0 ? (
              <p className="text-slate-500 text-center py-8">No grievances found</p>
            ) : (
              <div className="space-y-3">
                {grievances.map((g) => (
                  <div key={g.id} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            g.status === "submitted" ? "bg-blue-500/20 text-blue-400" :
                            g.status === "under_review" ? "bg-amber-500/20 text-amber-400" :
                            g.status === "resolved" ? "bg-green-500/20 text-green-400" :
                            "bg-red-500/20 text-red-400"
                          }`}>
                            {g.status.replace(/_/g, " ")}
                          </span>
                          <span className="font-mono text-slate-500 text-xs">{g.complaint_number || `#${g.id}`}</span>
                          <span className="text-slate-600 text-xs">• {g.category?.replace(/_/g, " ")}</span>
                        </div>
                        <h3 className="font-medium text-white">{g.subject}</h3>
                        <p className="text-slate-400 text-sm mt-1 line-clamp-2">{g.description}</p>
                        {g.employer_name && (
                          <p className="text-slate-500 text-xs mt-1">Employer: {g.employer_name}</p>
                        )}
                        <p className="text-slate-500 text-xs mt-1">
                          Filed: {g.created_at ? new Date(g.created_at).toLocaleDateString() : "-"}
                        </p>
                      </div>
                      <div className="ml-4 flex flex-col gap-2">
                        {g.status === "submitted" && (
                          <button
                            onClick={() => handleUpdateGrievanceStatus(g.id, "under_review")}
                            className="bg-amber-600 hover:bg-amber-700 text-white text-sm px-3 py-1.5 rounded-lg transition"
                          >
                            Review
                          </button>
                        )}
                        {g.status === "under_review" && (
                          <button
                            onClick={() => handleUpdateGrievanceStatus(g.id, "resolved")}
                            className="bg-green-600 hover:bg-green-700 text-white text-sm px-3 py-1.5 rounded-lg transition"
                          >
                            Resolve
                          </button>
                        )}
                        {g.status === "submitted" && (
                          <button
                            onClick={() => handleUpdateGrievanceStatus(g.id, "rejected")}
                            className="bg-red-600/50 hover:bg-red-700 text-white text-sm px-3 py-1.5 rounded-lg transition"
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Notifications Tab ──────────────────────────────── */}
        {!loading && activeTab === "notifications" && token && (
          <NotificationsPanel token={token} notifications={notifications} onSent={loadTabData} />
        )}

        {/* ── Officials Tab (superadmin monitoring) ──────── */}
        {!loading && activeTab === "officials" && govUser.is_superadmin && (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400">
                    <th className="text-left py-3 px-3">Employee ID</th>
                    <th className="text-left py-3 px-3">Name</th>
                    <th className="text-left py-3 px-3">Role</th>
                    <th className="text-left py-3 px-3">Jurisdiction</th>
                    <th className="text-right py-3 px-3">Workers</th>
                    <th className="text-right py-3 px-3">Grievances</th>
                  </tr>
                </thead>
                <tbody>
                  {officials.map((o) => (
                    <tr key={o.id} className="border-b border-slate-800 hover:bg-slate-800/50 transition">
                      <td className="py-3 px-3 font-mono text-blue-400">{o.employee_id || "-"}</td>
                      <td className="py-3 px-3">{o.full_name}</td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            o.is_superadmin
                              ? "bg-amber-500/20 text-amber-400"
                              : "bg-slate-500/20 text-slate-300"
                          }`}
                        >
                          {o.is_superadmin
                            ? "Super Admin"
                            : o.district
                              ? "District Official"
                              : o.state
                                ? "State Official"
                                : "Official"}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-300">
                        {o.is_superadmin
                          ? "All states"
                          : o.state
                            ? `${o.state}${o.district ? ` / ${o.district}` : ""}`
                            : "No jurisdiction"}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">{o.workers_in_scope}</td>
                      <td className="py-3 px-3 text-right tabular-nums">{o.grievances_in_scope}</td>
                    </tr>
                  ))}
                  {officials.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">No officials found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">
              Every official logs in with their own employee ID and sees only the jurisdiction above.
              Counts are live totals for that scope — the same numbers they see when they sign in.
            </p>
          </div>
        )}

        {/* ── Audit Logs Tab ─────────────────────────────────── */}
        {!loading && activeTab === "audit" && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold flex items-center gap-2">🔒 Audit Logs (Superadmin Only)</h2>
            {auditLogs.length === 0 ? (
              <p className="text-slate-500 text-center py-8">No audit logs found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-400">
                      <th className="text-left py-3 px-3">Time</th>
                      <th className="text-left py-3 px-3">Actor</th>
                      <th className="text-left py-3 px-3">Action</th>
                      <th className="text-left py-3 px-3">Resource</th>
                      <th className="text-left py-3 px-3">IP</th>
                      <th className="text-left py-3 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                        <td className="py-3 px-3 text-slate-300">
                          {log.timestamp ? new Date(log.timestamp).toLocaleString() : "-"}
                        </td>
                        <td className="py-3 px-3 font-mono text-blue-400">{log.actor_identifier}</td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded text-xs">{log.action}</span>
                        </td>
                        <td className="py-3 px-3 text-slate-300">{log.resource_type || "-"} #{log.resource_id || "-"}</td>
                        <td className="py-3 px-3 text-slate-500 font-mono text-xs">{log.ip_address || "-"}</td>
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            log.success ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                          }`}>
                            {log.success ? "OK" : "FAILED"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {/* ── Job Listings Tab ───────────────────────────────── */}
        {!loading && activeTab === "jobs" && <JobsPanel token={token} />}
      </main>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  color: string;
}) {
  const colors: Record<string, string> = {
    blue: "from-blue-500/20 to-blue-600/10 border-blue-500/30 text-blue-300",
    green: "from-green-500/20 to-green-600/10 border-green-500/30 text-green-300",
    amber: "from-amber-500/20 to-amber-600/10 border-amber-500/30 text-amber-300",
    emerald: "from-emerald-500/20 to-emerald-600/10 border-emerald-500/30 text-emerald-300",
  };
  return (
    <div className={`bg-gradient-to-br ${colors[color]} border rounded-2xl p-5 shadow-card`}>
      <div className="flex items-center justify-between mb-3">
        <span className={`w-9 h-9 rounded-xl bg-white/5 ring-1 ring-white/10 flex items-center justify-center ${colors[color].split(" ").pop()}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
      <p className="text-3xl font-bold font-display tabular-nums tracking-tight">{value}</p>
      <p className="text-slate-400 text-sm mt-1">{label}</p>
    </div>
  );
}
