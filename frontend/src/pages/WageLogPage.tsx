import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CalendarCheck, Copy, FileWarning } from "lucide-react";
import { Screen } from "../components/Screen";
import { Card, Badge, SkeletonList } from "../components/ui";
import { WageCalendar, formatMonthLabel } from "../components/WageCalendar";
import { Button } from "../components/ui/Button";
import { api, apiErrorMessage, apiErrorCode, isNetworkFailure } from "../api/client";
import { submitOnce } from "../api/idempotency";
import { addToSyncQueue } from "../services/offlineStorage";
import type { WageEntry, WageSummary } from "../types";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rupees(n: number): string {
  return `₹${Number(n || 0).toLocaleString("en-IN")}`;
}

/** The API returns work_date as a full ISO timestamp ("2026-01-15T00:00:00Z").
 *  The UI — and the complaint form's <input type="date"> — needs the plain
 *  UTC calendar day. */
function day(iso: string): string {
  return String(iso || "").slice(0, 10);
}

const STATUS_TONE: Record<WageEntry["payment_status"], "success" | "danger" | "warning"> = {
  paid: "success",
  unpaid: "danger",
  partial: "warning",
};

export default function WageLogPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [month, setMonth] = useState(currentMonth());
  const [entries, setEntries] = useState<WageEntry[] | null>(null);
  const [summary, setSummary] = useState<WageSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Add-entry form
  const [workDate, setWorkDate] = useState(todayISO());
  const [employerName, setEmployerName] = useState("");
  const [agreedAmount, setAgreedAmount] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [listRes, sumRes] = await Promise.all([
        api.get<{ entries: WageEntry[] }>("/wages", { params: { month } }),
        api.get<WageSummary>("/wages/summary", { params: { month } }),
      ]);
      setEntries(listRes.data.entries ?? []);
      setSummary(sumRes.data);
    } catch {
      setEntries([]);
      setLoadError(t("common.error"));
    }
  }, [month, t]);

  useEffect(() => {
    load();
  }, [load]);

  // A lost reply must not become a 409 on retry — the same submission keeps its
  // key until the server has confirmed it.
  const submissionKey = useRef<string | null>(null);
  const [queuedOffline, setQueuedOffline] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSavedOk(false);
    const agreed = Number(agreedAmount);
    const paid = paidAmount.trim() === "" ? 0 : Number(paidAmount);
    if (
      !workDate ||
      !Number.isFinite(agreed) ||
      agreed < 0 ||
      !Number.isFinite(paid) ||
      paid < 0 ||
      paid > agreed
    ) {
      setFormError(t("wages.invalidAmounts"));
      return;
    }
    // Paid days are locked: a fully settled day sheet can no longer be edited.
    const existing = (entries ?? []).find((e) => day(e.work_date) === workDate);
    if (existing && existing.payment_status === "paid") {
      setFormError(t("wages.paidLocked"));
      return;
    }
    setSaving(true);
    setQueuedOffline(false);
    const payload = {
      work_date: workDate,
      employer_name: employerName || undefined,
      agreed_amount: agreed,
      paid_amount: paid,
    };
    // Keep the day when there is no signal. It goes into the queue with its key,
    // so the replay writes the entry once — and reports the outcome instead of
    // claiming the office already has it.
    const queueOffline = async () => {
      try {
        await addToSyncQueue("wage", "create", {
          ...payload,
          client_request_id: submissionKey.current ?? undefined,
        });
        setAgreedAmount("");
        setPaidAmount("");
        setQueuedOffline(true);
      } catch {
        setFormError(t("errors.network"));
      }
    };
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await queueOffline();
      setSaving(false);
      return;
    }
    try {
      // Upsert by date — saving the same day again replaces the entry. The key
      // makes a retry of THIS submission a replay rather than an edit: without
      // it, a retry after a lost reply would be refused by the paid-day lock
      // for a change it is not making.
      await submitOnce(submissionKey, payload, (body) => api.post("/wages", body));
      setSavedOk(true);
      setAgreedAmount("");
      setPaidAmount("");
      await load();
    } catch (err) {
      if (isNetworkFailure(err)) {
        await queueOffline();
        return;
      }
      // Server-side paid-day lock (409) — localized message, not the API's English detail.
      const code = apiErrorCode(err);
      setFormError(
        code === "wage_paid_locked"
          ? t("wages.paidLocked")
          : apiErrorMessage(err, t("common.error")),
      );
    } finally {
      setSaving(false);
    }
  };

  // Rows where agreed > paid — the days a complaint can actually cite.
  const unpaidEntries = (entries ?? []).filter((e) => e.agreed_amount > e.paid_amount);

  // Deep-links to the complaint form carrying everything the diary already
  // knows: category, amount, the month, the specific unpaid dates and the
  // employer — so the worker edits rather than retypes.
  const fileGrievance = (opts: {
    amount: number;
    dates: string[];
    days: number;
    date?: string;
    employer?: string | null;
  }) => {
    navigate("/worker/grievances/new", {
      state: {
        category: "unpaid_wages",
        subject: t("wages.grievanceSubject", { amount: rupees(opts.amount) }),
        description: t("wages.grievanceDescription", {
          amount: rupees(opts.amount),
          period: month,
          days: opts.days,
          dates: opts.dates.join(", "),
        }),
        incident_date: opts.date ?? opts.dates[0] ?? "",
        employer_name: opts.employer ?? "",
      },
    });
  };

  // From the month summary: ask the SERVER for the draft, so every day in it
  // says whether the employer confirmed it. A confirmed day carries its
  // engagement and wage slip; a self-reported day says it is only the worker's
  // own account. Falls back to the local draft if the request fails — the
  // worker is never blocked from filing.
  const fileUnpaidGrievance = async () => {
    if (!summary || summary.total_unpaid <= 0) return;
    try {
      const res = await api.get<{
        subject: string;
        description: string;
        incident_date: string;
        employer_name: string | null;
        suggested_evidence: { kind: string; ref_id: string; label: string }[];
      }>("/wages/grievance-prefill", { params: { month } });
      const draft = res.data;
      navigate("/worker/grievances/new", {
        state: {
          category: "unpaid_wages",
          subject: draft.subject,
          description: draft.description,
          incident_date: draft.incident_date || "",
          employer_name: draft.employer_name ?? "",
          evidence: draft.suggested_evidence ?? [],
        },
      });
      return;
    } catch {
      // fall through to the local draft below
    }
    const dates = unpaidEntries.map((e) => day(e.work_date));
    fileGrievance({
      amount: summary.total_unpaid,
      dates,
      days: summary.days_logged,
      date: dates[0],
      employer: unpaidEntries[0]?.employer_name,
    });
  };

  /** Yesterday's entry, if there is one — the source for "same as yesterday". */
  const yesterdayEntry = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
    return (entries ?? []).find((e) => day(e.work_date) === iso);
  })();

  const copyYesterday = () => {
    if (!yesterdayEntry) return;
    setWorkDate(todayISO());
    setEmployerName(yesterdayEntry.employer_name ?? "");
    setAgreedAmount(String(yesterdayEntry.agreed_amount));
    setPaidAmount(String(yesterdayEntry.paid_amount));
    setSavedOk(false);
    setFormError(null);
  };

  const summaryCards = summary
    ? [
        {
          label: t("wages.summaryDays"),
          value: String(summary.days_logged),
          tone: "text-gray-900 dark:text-gray-100",
        },
        {
          label: t("wages.summaryAgreed"),
          value: rupees(summary.total_agreed),
          tone: "text-gray-900 dark:text-gray-100",
        },
        {
          label: t("wages.summaryPaid"),
          value: rupees(summary.total_paid),
          tone: "text-green-700 dark:text-green-400",
        },
        {
          label: t("wages.summaryUnpaid"),
          value: rupees(summary.total_unpaid),
          tone: "text-red-700 dark:text-red-400",
        },
      ]
    : [];

  return (
    <Screen title={t("wages.title")} onBack={true}>
      <div className="space-y-4 mt-4 pb-10">
        {/* Summary header */}
        <Card className="!p-4">
          <div className="flex items-center justify-between mb-3 gap-3">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              {t("wages.subtitle")}
            </h2>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value || currentMonth())}
              className="input-field !w-auto !py-1.5 text-sm"
              aria-label={t("wages.month")}
            />
          </div>
          {summary === null ? (
            <SkeletonList rows={1} />
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {summaryCards.map((c) => (
                <div
                  key={c.label}
                  className="rounded-xl bg-gray-50 dark:bg-gray-900/60 px-3 py-2.5"
                >
                  <p className={`text-lg font-bold tabular-nums ${c.tone}`}>{c.value}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{c.label}</p>
                </div>
              ))}
            </div>
          )}
          {summary && (
            <div className="flex gap-2 mt-3">
              {summary.total_unpaid > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  onClick={fileUnpaidGrievance}
                >
                  <FileWarning className="h-4 w-4" aria-hidden="true" />
                  {t("wages.fileGrievance")}
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                className={summary.total_unpaid > 0 ? "flex-1" : "w-full"}
                onClick={() => {
                  const headers = [
                    "work_date",
                    "employer_name",
                    "agreed_amount",
                    "paid_amount",
                    "payment_status",
                    "balance",
                  ];
                  const rows = (entries ?? []).map((e) => [
                    day(e.work_date),
                    e.employer_name || "",
                    String(e.agreed_amount),
                    String(e.paid_amount),
                    e.payment_status,
                    String(Math.max(0, e.agreed_amount - e.paid_amount)),
                  ]);
                  const csv = [
                    headers.join(","),
                    ...rows.map((r) =>
                      r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","),
                    ),
                  ].join("\n");
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `wage-log-${month}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                {t("wages.exportCSV", "Export CSV")}
              </Button>
            </div>
          )}
        </Card>

        {/* The month at a glance, before the form: what did I work, what is
            still owed. Tapping a square fills the date into the form below. */}
        <Card className="!p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("wages.calendarLabel", { month: formatMonthLabel(month, i18n.language || "en") })}
          </h2>
          {entries === null ? (
            <SkeletonList rows={2} />
          ) : (
            <WageCalendar
              month={month}
              entries={entries}
              selectedDay={workDate}
              onSelectDay={(iso) => {
                setWorkDate(iso);
                setSavedOk(false);
                setFormError(null);
              }}
            />
          )}
        </Card>

        {/* Add-entry form (upserts the day sheet) */}
        <Card className="!p-4">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            {t("wages.addEntry")}
          </h2>
          <form onSubmit={handleSubmit} noValidate className="space-y-3">
            {yesterdayEntry && (
              <button
                type="button"
                onClick={copyYesterday}
                className="flex min-h-tap w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-line bg-surface-raised px-3 text-sm font-semibold text-ink-secondary
                  hover:border-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
                {t("wages.sameAsYesterday")}
              </button>
            )}
            <div>
              <label
                htmlFor="wage-date"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                {t("wages.workDate")}
              </label>
              <input
                id="wage-date"
                type="date"
                required
                className="input-field"
                value={workDate}
                onChange={(e) => setWorkDate(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="wage-employer"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                {t("wages.employer")}
              </label>
              <input
                id="wage-employer"
                className="input-field"
                maxLength={200}
                value={employerName}
                onChange={(e) => setEmployerName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="wage-agreed"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  {t("wages.agreedAmount")}
                </label>
                <input
                  id="wage-agreed"
                  type="number"
                  min="0"
                  step="1"
                  required
                  inputMode="numeric"
                  className="input-field"
                  value={agreedAmount}
                  onChange={(e) => setAgreedAmount(e.target.value)}
                />
              </div>
              <div>
                <label
                  htmlFor="wage-paid"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  {t("wages.paidAmount")}
                </label>
                <input
                  id="wage-paid"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  className="input-field"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                />
              </div>
            </div>
            {formError && (
              <p role="alert" className="field-error">
                {formError}
              </p>
            )}
            {queuedOffline && (
              <p role="status" className="text-sm text-green-700 dark:text-green-400">
                {t("wages.savedOffline")}
              </p>
            )}
            {savedOk && !formError && (
              <p role="status" className="text-sm text-green-700 dark:text-green-400">
                {t("wages.savedOk")}
              </p>
            )}
            <Button type="submit" loading={saving} className="w-full">
              {saving ? t("wages.saving") : t("wages.save")}
            </Button>
          </form>
        </Card>

        {/* Monthly list */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            {t("wages.month")}
          </h2>
          {loadError && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300 mb-2">
              {loadError}
            </p>
          )}
          {entries === null ? (
            <SkeletonList rows={2} />
          ) : entries.length === 0 ? (
            <Card className="text-center py-6">
              <p className="text-sm text-gray-400">{t("wages.empty")}</p>
            </Card>
          ) : (
            <div className="space-y-2.5">
              {entries.map((w) => (
                <Card key={w.id} className="!p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {day(w.work_date)}
                        {w.employer_name ? (
                          <span className="text-gray-400"> · {w.employer_name}</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 tabular-nums">
                        {t("wages.agreedAmountShort")} {rupees(w.agreed_amount)} ·{" "}
                        {t("wages.paidAmountShort")} {rupees(w.paid_amount)}
                      </p>
                      {w.agreed_amount > w.paid_amount && (
                        <button
                          onClick={() =>
                            fileGrievance({
                              amount: w.agreed_amount - w.paid_amount,
                              dates: [day(w.work_date)],
                              days: 1,
                              date: day(w.work_date),
                              employer: w.employer_name,
                            })
                          }
                          className="mt-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                        >
                          {t("wages.fileForDate", { date: day(w.work_date) })}
                        </button>
                      )}
                    </div>
                    <Badge tone={STATUS_TONE[w.payment_status] ?? "neutral"}>
                      {t(`wages.status.${w.payment_status}`, w.payment_status)}
                    </Badge>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
          {t("wages.selfReported")}
        </p>

        {summary && summary.total_unpaid > 0 && (
          <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 flex items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-3 py-2.5 shadow-lg">
            <CalendarCheck
              className="h-5 w-5 shrink-0 text-red-700 dark:text-red-300"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-ink-muted">{t("wages.summaryUnpaid")}</p>
              <p className="text-base font-bold tabular-nums text-red-800 dark:text-red-300">
                {rupees(summary.total_unpaid)}
              </p>
            </div>
            <Button size="sm" onClick={fileUnpaidGrievance} className="!w-auto shrink-0">
              {t("wages.makeComplaint")}
            </Button>
          </div>
        )}
      </div>
    </Screen>
  );
}
