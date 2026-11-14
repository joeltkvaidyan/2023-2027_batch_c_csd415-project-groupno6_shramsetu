import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Screen } from "../components/Screen";
import { BottomNav } from "../components/BottomNav";
import { GrievanceStatusBadge } from "../components/GrievanceStatusBadge";
import { SkeletonList } from "../components/ui";
import { Plus } from "lucide-react";
import { api } from "../api/client";
import type { Grievance } from "../types";

export default function GrievanceListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [grievances, setGrievances] = useState<Grievance[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<string>("");

  const load = () => {
    setLoading(true);
    setLoadError(false);
    const params: { limit: number; status?: string; category?: string } = { limit: 100 };
    if (filterStatus) params.status = filterStatus;
    if (filterCategory) params.category = filterCategory;
    api
      .get<Grievance[]>("/grievances", { params })
      .then((res) => setGrievances(res.data))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(load, [filterStatus, filterCategory]);

  return (
    <>
      <Screen title={t("grievance.title")}>
        <button
          onClick={() => navigate("/worker/grievances/new")}
          className="btn-primary mb-4 flex items-center justify-center gap-2 !w-auto px-6 py-3.5 text-base mx-auto"
        >
          <Plus className="h-5 w-5" aria-hidden="true" /> {t("grievance.fileNew")}
        </button>

        {/* Search and Filter */}
        <div className="mb-4 space-y-2">
          <input
            type="text"
            className="input-field"
            placeholder={`🔍 ${t("grievance.searchPlaceholder")}`}
            aria-label={t("grievance.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="flex gap-2">
            <select
              className="input-field flex-1 text-sm"
              aria-label={t("grievance.allStatus")}
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">{t("grievance.allStatus")}</option>
              <option value="submitted">📥 {t("grievance.status.submitted")}</option>
              <option value="under_review">🔍 {t("grievance.status.under_review")}</option>
              <option value="resolved">✅ {t("grievance.status.resolved")}</option>
              <option value="rejected">❌ {t("grievance.status.rejected")}</option>
              <option value="withdrawn">🚫 {t("grievance.status.withdrawn")}</option>
              <option value="escalated">{t("grievance.status.escalated")}</option>
            </select>
            <select
              className="input-field flex-1 text-sm"
              aria-label={t("grievance.allCategories")}
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
            >
              <option value="">{t("grievance.allCategories")}</option>
              <option value="unpaid_wages">💰 {t("grievance.categories.unpaid_wages")}</option>
              <option value="workplace_safety">
                ⚠️ {t("grievance.categories.workplace_safety")}
              </option>
              <option value="harassment_abuse">
                🛡️ {t("grievance.categories.harassment_abuse")}
              </option>
              <option value="illegal_termination">
                🚫 {t("grievance.categories.illegal_termination")}
              </option>
              <option value="document_issue">📄 {t("grievance.categories.document_issue")}</option>
              <option value="employer_dispute">
                💼 {t("grievance.categories.employer_dispute")}
              </option>
              <option value="insurance_claim">
                🏥 {t("grievance.categories.insurance_claim")}
              </option>
              <option value="accommodation">🏠 {t("grievance.categories.accommodation")}</option>
              <option value="other">📋 {t("grievance.categories.other")}</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="pb-10" aria-hidden="true">
            <SkeletonList rows={3} rowClass="h-20" />
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <p className="text-sm text-gray-500">{t("grievance.loadError")}</p>
            <button
              onClick={load}
              className="text-sm font-semibold text-brand-600 dark:text-brand-400 underline"
            >
              {t("common.retry")}
            </button>
          </div>
        ) : grievances.length === 0 ? (
          <p className="text-gray-400 text-center py-10">{t("grievance.noComplaints")}</p>
        ) : (
          <div className="space-y-3 pb-10">
            {grievances
              .filter((g) => {
                if (!searchQuery) return true;
                const q = searchQuery.toLowerCase();
                return (
                  g.subject.toLowerCase().includes(q) ||
                  g.complaint_number.toLowerCase().includes(q) ||
                  g.description?.toLowerCase().includes(q) ||
                  g.employer_name?.toLowerCase().includes(q)
                );
              })
              .map((g) => (
                <button
                  key={g.id}
                  onClick={() => navigate(`/worker/grievances/${g.id}`)}
                  className="card w-full text-left active:scale-[0.98] transition"
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="text-xs font-mono text-gray-400">{g.complaint_number}</span>
                    <div className="flex gap-1">
                      {g.priority === "urgent" && (
                        <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">
                          🔴 {t("grievance.priorityUrgent")}
                        </span>
                      )}
                      {g.priority === "high" && (
                        <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">
                          🟠 {t("grievance.priorityHigh")}
                        </span>
                      )}
                      {g.escalated && (
                        <span className="text-xs bg-red-500 text-white px-1.5 py-0.5 rounded animate-pulse">
                          {t("grievance.status.escalated")}
                        </span>
                      )}
                      <GrievanceStatusBadge status={g.status} />
                    </div>
                  </div>
                  <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {g.subject}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t(`grievance.categories.${g.category}`)} ·{" "}
                    {new Date(g.created_at).toLocaleDateString()}
                  </p>
                  {g.sla_deadline && (
                    <p className="text-xs text-gray-400 mt-1">
                      ⏰ {t("grievance.due")}: {new Date(g.sla_deadline).toLocaleDateString()}
                      {new Date(g.sla_deadline) < new Date() && g.status !== "resolved" && (
                        <span className="text-red-500 font-semibold ml-1">
                          ({t("grievance.overdue")})
                        </span>
                      )}
                    </p>
                  )}
                </button>
              ))}
          </div>
        )}
      </Screen>
      <BottomNav />
    </>
  );
}
