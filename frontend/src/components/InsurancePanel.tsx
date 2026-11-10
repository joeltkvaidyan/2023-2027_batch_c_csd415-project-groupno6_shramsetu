import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, ShieldAlert, Trash2, Plus } from "lucide-react";
import { Card, Badge, Button, Field } from "./ui";
import { apiErrorMessage } from "../api/client";
import {
  addMyPolicy,
  removeMyPolicy,
  type CoverageType,
  type OwnInsurance,
  type OwnPolicy,
} from "../api/insuranceClient";

/**
 * The worker's own insurance records: what is on file, and a form to add cover.
 *
 * Kept off the card itself and out of the print stylesheet, because everything
 * here is a claim about cover rather than cover itself — the card carries the
 * one-line answer, this panel carries the record behind it.
 *
 * The panel refuses to let the UI overstate what it knows: a policy the worker
 * typed in says "not yet verified", and only a labour office can change that.
 * Removing a verified policy is blocked by the server, so the button is hidden
 * rather than shown and then refused.
 */
const COVERAGES: CoverageType[] = ["accident", "hospitalisation", "disability", "death"];

function statusTone(status: OwnPolicy["status"]): "success" | "warning" | "danger" {
  if (status === "active") return "success";
  if (status === "upcoming") return "warning";
  return "danger";
}

function useFormatters() {
  const { t, i18n } = useTranslation();
  const date = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(i18n.language, { day: "2-digit", month: "short", year: "numeric" });
  };
  const money = (amount: number | null) =>
    amount == null
      ? "—"
      : new Intl.NumberFormat(i18n.language === "en" ? "en-IN" : i18n.language, {
          style: "currency",
          currency: "INR",
          maximumFractionDigits: 0,
        }).format(amount);
  const coverageLabel = (coverage: CoverageType) =>
    t(`insurance.coverage.${coverage}`, coverage) as string;
  return { date, money, coverageLabel };
}

export function InsurancePanel({
  data,
  onChanged,
}: {
  data: OwnInsurance | null;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { date, money, coverageLabel } = useFormatters();

  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [coverage, setCoverage] = useState<CoverageType>("accident");
  const [sumInsured, setSumInsured] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const policies = data?.policies ?? [];

  const reset = () => {
    setProvider("");
    setPolicyNumber("");
    setCoverage("accident");
    setSumInsured("");
    setValidFrom("");
    setValidTo("");
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const amount = Number(sumInsured);
    if (provider.trim().length < 2) {
      setError(t("insurance.errProvider", "Enter the insurance company's name."));
      return;
    }
    if (policyNumber.trim().length < 3) {
      setError(t("insurance.errPolicyNumber", "Enter the policy number from the policy document."));
      return;
    }
    if (!Number.isFinite(amount) || amount < 1) {
      setError(t("insurance.errAmount", "Enter the amount the policy covers, in rupees."));
      return;
    }
    if (!validFrom || !validTo) {
      setError(t("insurance.errDates", "Enter the start and end date of the policy."));
      return;
    }

    setSaving(true);
    try {
      await addMyPolicy({
        provider: provider.trim(),
        policy_number: policyNumber.trim(),
        coverage,
        sum_insured: Math.round(amount),
        valid_from: validFrom,
        valid_to: validTo,
      });
      reset();
      setOpen(false);
      onChanged();
    } catch (err) {
      setError(
        apiErrorMessage(err, t("insurance.saveFailed", "Could not save this policy. Try again.")),
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setRemoving(id);
    setError(null);
    try {
      await removeMyPolicy(id);
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, t("insurance.removeFailed", "Could not remove this policy.")));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <section className="mt-5 print:hidden">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t("insurance.title", "Insurance")}
        </h2>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-brand-700 dark:text-brand-400"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("insurance.addCta", "Add policy")}
          </button>
        )}
      </div>

      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
        {t(
          "insurance.subtitle",
          "Accident and health cover, shown on your card once a labour office checks it.",
        )}
      </p>

      {policies.length === 0 && (
        <Card className="mt-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("insurance.none", "No policy is on record yet.")}
          </p>
        </Card>
      )}

      <div className="mt-3 space-y-2">
        {policies.map((p) => (
          <Card key={p.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold break-words text-gray-900 dark:text-gray-100">
                  {p.provider}
                </p>
                <p className="mt-0.5 text-xs break-words text-gray-600 dark:text-gray-400">
                  {coverageLabel(p.coverage)} · {money(p.sum_insured)} ·{" "}
                  {t("insurance.until", "until {date}", { date: date(p.valid_to) })}
                </p>
                <p className="mt-0.5 font-mono text-[11px] break-all text-gray-500">
                  {p.policy_number}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone={statusTone(p.status)}>
                    {p.status === "active"
                      ? t("insurance.statusActive", "In force")
                      : p.status === "upcoming"
                        ? t("insurance.statusUpcoming", "Starts later")
                        : t("insurance.statusExpired", "Expired")}
                  </Badge>
                  <Badge tone={p.verification === "office_verified" ? "success" : "neutral"}>
                    {p.verification === "office_verified" ? (
                      <>
                        <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
                        {t("insurance.verified", "Checked by an office")}
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="mr-1 h-3 w-3" aria-hidden="true" />
                        {t("insurance.unverified", "Not yet verified")}
                      </>
                    )}
                  </Badge>
                </div>
              </div>

              {p.verification === "self_declared" && (
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  disabled={removing === p.id}
                  aria-label={t("insurance.remove", "Remove")}
                  className="shrink-0 rounded-lg p-2 text-gray-400 transition hover:text-red-600 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>

      {open && (
        <Card className="mt-3">
          <form onSubmit={submit} className="space-y-3">
            <Field
              label={t("insurance.provider", "Insurance company")}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder={t("insurance.providerPlaceholder", "As printed on the policy")}
              autoComplete="organization"
            />
            <Field
              label={t("insurance.policyNumber", "Policy number")}
              value={policyNumber}
              onChange={(e) => setPolicyNumber(e.target.value)}
              placeholder={t("insurance.policyNumberPlaceholder", "e.g. NIC/KA/2026/0099231")}
              hint={t(
                "insurance.policyNumberHint",
                "Only the last four digits are shown to anyone who scans your card.",
              )}
            />

            <div>
              <label
                htmlFor="insurance-coverage"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t("insurance.coverageLabel", "What it covers")}
              </label>
              <select
                id="insurance-coverage"
                className="input-field"
                value={coverage}
                onChange={(e) => setCoverage(e.target.value as CoverageType)}
              >
                {COVERAGES.map((c) => (
                  <option key={c} value={c}>
                    {coverageLabel(c)}
                  </option>
                ))}
              </select>
            </div>

            <Field
              label={t("insurance.sumInsured", "Cover amount (₹)")}
              type="number"
              inputMode="numeric"
              min={1}
              value={sumInsured}
              onChange={(e) => setSumInsured(e.target.value)}
              placeholder="200000"
            />

            <div className="flex flex-wrap gap-3">
              <div className="min-w-0 flex-1">
                <Field
                  label={t("insurance.validFrom", "Starts")}
                  type="date"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                />
              </div>
              <div className="min-w-0 flex-1">
                <Field
                  label={t("insurance.validTo", "Ends")}
                  type="date"
                  value={validTo}
                  onChange={(e) => setValidTo(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? t("insurance.saving", "Saving...") : t("insurance.save", "Save policy")}
              </Button>
              <button
                type="button"
                onClick={() => {
                  reset();
                  setOpen(false);
                }}
                className="shrink-0 rounded-xl px-4 text-sm font-semibold text-gray-600 dark:text-gray-400"
              >
                {t("common.cancel", "Cancel")}
              </button>
            </div>
          </form>
        </Card>
      )}

      {error && !open && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
