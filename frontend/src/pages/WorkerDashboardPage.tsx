import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  FileText,
  Sparkles,
  Megaphone,
  Settings,
  ChevronRight,
  Copy,
  Check,
  Clock,
  IndianRupee,
  Briefcase,
  Building2,
  ThermometerSun,
  Handshake,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "../store/AuthContext";
import { BottomNav } from "../components/BottomNav";
import { Card, Badge, Avatar, SkeletonList } from "../components/ui";
import { api } from "../api/client";
import type { Employer, Grievance, JobMatch } from "../types";

export default function WorkerDashboardPage() {
  const { t } = useTranslation();
  const { worker } = useAuth();
  const navigate = useNavigate();
  const govStatus = worker?.gov_approve_status ?? "accepted";
  const [copied, setCopied] = useState(false);
  const [recent, setRecent] = useState<Grievance[] | null>(null);
  // Phase 2 snapshot: job matches, saved recurring employers, unpaid wages.
  const [snapshot, setSnapshot] = useState<{
    jobs: number;
    employers: number;
    unpaid: number;
  } | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<Grievance[]>("/grievances", { params: { limit: 3 } })
      .then((res) => active && setRecent(res.data))
      .catch(() => active && setRecent([]));

    Promise.all([
      api.get<{ jobs: JobMatch[] }>("/jobs"),
      api.get<{ employers: Employer[] }>("/employers"),
      api.get<{ total_unpaid: number }>("/wages/summary"),
    ])
      .then(([jobs, employers, wages]) => {
        if (!active) return;
        setSnapshot({
          jobs: jobs.data.jobs.length,
          employers: employers.data.employers.length,
          unpaid: wages.data.total_unpaid,
        });
      })
      .catch(() => active && setSnapshot(null));

    return () => {
      active = false;
    };
  }, []);

  if (!worker) return null;

  const copyWorkerId = async () => {
    try {
      await navigator.clipboard.writeText(worker.worker_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — non-critical */
    }
  };

  const greetingKey =
    new Date().getHours() < 12 ? "dashboard.greetingMorning" : new Date().getHours() < 17 ? "dashboard.greetingAfternoon" : "dashboard.greetingEvening";

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-36">
      {/* Header — brand gradient with real avatar + greeting */}
      <header className="bg-gradient-to-br from-brand-700 via-brand-600 to-brand-800 text-white px-5 pt-8 pb-12 rounded-b-[2rem] relative overflow-hidden animate-fade-in">
        {/* Subtle decorative glow */}
        <div className="absolute -top-20 -right-16 w-56 h-56 rounded-full bg-white/5 pointer-events-none animate-aurora-shift" aria-hidden="true" />
        <div className="absolute -bottom-24 -left-10 w-48 h-48 rounded-full bg-emerald-300/10 blur-2xl pointer-events-none animate-float" aria-hidden="true" />
        <div className="flex items-center gap-4 relative">
          <Avatar name={worker.full_name} size="lg" className="ring-2 ring-white/30" />
          <div className="min-w-0">
            <p className="text-brand-100 text-sm">{t(greetingKey, "Welcome,")}</p>
            <h1 className="text-xl font-bold truncate">{worker.full_name}</h1>
          </div>
        </div>
      </header>

      <main className="px-4 -mt-8 relative">
        {/* Government acceptance gate — the single honest status badge */}
        {govStatus !== "accepted" && (
          <div
            className={`mb-4 rounded-2xl border p-4 flex items-start gap-3 animate-fade-up ${
              govStatus === "rejected"
                ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                : "bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-800"
            }`}
            role="status"
          >
            <span className="text-xl shrink-0" aria-hidden="true">{govStatus === "rejected" ? "❌" : "⏳"}</span>
            <div>
              <p className={`font-semibold text-sm ${govStatus === "rejected" ? "text-red-700 dark:text-red-300" : "text-amber-900 dark:text-amber-200"}`}>
                {govStatus === "rejected"
                  ? "Registration not accepted"
                  : "Waiting for government approval"}
              </p>
              <p className={`text-xs mt-0.5 ${govStatus === "rejected" ? "text-red-600 dark:text-red-400" : "text-amber-800 dark:text-amber-300"}`}>
                {govStatus === "rejected"
                  ? "A labour-office official did not verify this registration. Please visit your nearest labour office."
                  : "A labour-office official must accept your registration before you can apply to jobs or appear in the directory employers use to call workers."}
              </p>
            </div>
          </div>
        )}

        {/* Worker ID card — the product's "Aadhaar-lite" identity moment */}
        <Card className="!p-0 overflow-hidden animate-rise">
          <div className="flex items-center justify-between px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">
                {t("dashboard.yourWorkerId")}
              </p>
              <p className="text-lg font-mono font-bold text-brand-700 dark:text-brand-400">{worker.worker_id}</p>
            </div>
            <div className="flex items-center gap-3">
              {/* Digital ID QR — encodes the worker_id only. It is an offline
                  identity helper, not a verifiable credential. */}
              <span
                className="w-14 h-14 rounded-lg border border-gray-200 dark:border-gray-600 bg-white p-0.5 inline-flex items-center justify-center shrink-0"
                title={t("dashboard.qrCode", "QR Code")}
              >
                <QRCodeSVG
                  value={worker.worker_id}
                  size={52}
                  level="M"
                  aria-label={t("dashboard.qrCode", "QR Code")}
                  role="img"
                />
              </span>
              <button
                onClick={copyWorkerId}
                className="p-2 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30 transition"
                aria-label={t("dashboard.copyWorkerId", "Copy worker ID")}
              >
                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </Card>

        {/* Work snapshot — job matches, recurring employers, unpaid wages */}
        {snapshot && (
          <Card className="mt-5 animate-rise">
            <div className="grid grid-cols-3 gap-2 text-center">
              <button onClick={() => navigate("/worker/jobs")} className="active:scale-95 transition">
                <p className="text-lg font-bold text-brand-700 dark:text-brand-400">{snapshot.jobs}</p>
                <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">
                  {t("dashboard.jobMatches", "Job matches")}
                </p>
              </button>
              <button onClick={() => navigate("/worker/employers")} className="active:scale-95 transition">
                <p className="text-lg font-bold text-brand-700 dark:text-brand-400">{snapshot.employers}</p>
                <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">
                  {t("dashboard.employers", "Employers")}
                </p>
              </button>
              <button onClick={() => navigate("/worker/wages")} className="active:scale-95 transition">
                <p className="text-lg font-bold text-brand-700 dark:text-brand-400">₹{snapshot.unpaid}</p>
                <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">
                  {t("dashboard.unpaid", "Unpaid")}
                </p>
              </button>
            </div>
          </Card>
        )}

        {/* Primary actions */}
        <div className="grid grid-cols-2 gap-3.5 mt-5">
          <ActionTile
            Icon={FileText}
            label={t("dashboard.documentWallet")}
            onClick={() => navigate("/worker/documents")}
            delay={60}
          />
          <ActionTile
            Icon={Sparkles}
            label={t("dashboard.aiChatbot")}
            onClick={() => navigate("/worker/chat")}
            featured
            delay={120}
          />
          <ActionTile
            Icon={Megaphone}
            label={t("grievance.title")}
            onClick={() => navigate("/worker/grievances")}
            delay={180}
          />
          <ActionTile
            Icon={IndianRupee}
            label={t("wages.title", "Wage Diary")}
            onClick={() => navigate("/worker/wages")}
            delay={240}
          />
          <ActionTile
            Icon={Briefcase}
            label={t("jobs.title", "Job matches")}
            onClick={() => navigate("/worker/jobs")}
            delay={280}
          />
          <ActionTile
            Icon={Handshake}
            label={t("requests.tile", "House requests")}
            onClick={() => navigate("/worker/requests")}
            delay={320}
          />
          <ActionTile
            Icon={Building2}
            label={t("employers.title", "Recurring employers")}
            onClick={() => navigate("/worker/employers")}
            delay={340}
          />
          <ActionTile
            Icon={ThermometerSun}
            label={t("dashboard.heatSafety", "Heat safety")}
            onClick={() =>
              navigate("/worker/chat", {
                state: {
                  initialQuestion: t(
                    "chat.heatPrefillQuestion",
                    "What should I do to stay safe during extreme heat?",
                  ),
                },
              })
            }
            delay={360}
          />
          <ActionTile
            Icon={Settings}
            label={t("dashboard.settings")}
            onClick={() => navigate("/worker/settings")}
            delay={300}
          />
        </div>

        {/* Recent grievances */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              {t("dashboard.recentGrievances", "Recent complaints")}
            </h2>
            <button
              onClick={() => navigate("/worker/grievances")}
              className="text-xs font-semibold text-brand-600 dark:text-brand-400 flex items-center gap-0.5"
            >
              {t("common.viewAll", "View all")}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {recent === null ? (
            <SkeletonList rows={2} />
          ) : recent.length === 0 ? (
            <Card className="text-center py-6">
              <p className="text-sm text-gray-400">{t("grievance.empty", "No complaints yet")}</p>
              <button
                onClick={() => navigate("/worker/grievances/new")}
                className="text-sm font-semibold text-brand-600 dark:text-brand-400 mt-2"
              >
                + {t("grievance.fileNew", "File a complaint")}
              </button>
            </Card>
          ) : (
            <div className="space-y-2.5">
              {recent.map((g) => (
                <Card
                  key={g.id}
                  interactive
                  onClick={() => navigate(`/worker/grievances/${g.id}`)}
                  className="!p-3.5 animate-rise"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{g.subject}</p>
                      <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {g.created_at ? new Date(g.created_at).toLocaleDateString() : ""}
                      </p>
                    </div>
                    <Badge tone="info" dot>
                      {t(`grievance.status.${g.status}`, g.status)}
                    </Badge>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>

      <BottomNav />
    </div>
  );
}

function ActionTile({
  Icon,
  label,
  onClick,
  featured = false,
  delay = 0,
}: {
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement> & { size?: number | string }>;
  label: string;
  onClick: () => void;
  featured?: boolean;
  delay?: number;
}) {
  return (
    <button
      onClick={onClick}
      style={{ animationDelay: `${delay}ms` }}
      className={`card !p-0 overflow-hidden text-left active:scale-[0.97] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 animate-fade-up hover:shadow-card-hover ${
        featured
          ? "bg-gradient-to-br from-brand-600 to-brand-800 border-transparent text-white shadow-glow-brand"
          : ""
      }`}
    >
      <div className="flex flex-col gap-2.5 py-6 px-4 items-center justify-center">
        <span
          className={`w-11 h-11 rounded-xl flex items-center justify-center ${
            featured ? "bg-white/15" : "bg-brand-50 dark:bg-brand-900/30"
          }`}
        >
          <Icon
            className={`h-6 w-6 ${featured ? "text-white" : "text-brand-600 dark:text-brand-400"}`}
            strokeWidth={1.9}
          />
        </span>
        <span
          className={`text-sm font-semibold text-center leading-snug ${
            featured ? "text-white" : "text-gray-800 dark:text-gray-100"
          }`}
        >
          {label}
        </span>
      </div>
    </button>
  );
}
