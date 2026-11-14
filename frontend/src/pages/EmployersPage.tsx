import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2, IndianRupee, Pencil, Plus, Trash2 } from "lucide-react";
import { Screen } from "../components/Screen";
import { Card, SkeletonList } from "../components/ui";
import { Button } from "../components/ui/Button";
import { InputField } from "../components/InputField";
import { api, apiErrorMessage } from "../api/client";
import { OCCUPATIONS, occupationLabelKey } from "../components/register/constants";
import type { Employer } from "../types";

/**
 * "Recurring employers" — the worker's own list of employers they work for
 * regularly, with totals derived only from that worker's wage entries.
 *
 * Nothing here is shared with, or visible to, another worker or an employer
 * account; the copy says so, because a worker-entered record must never look
 * like a verified employer profile.
 */
interface FormState {
  name: string;
  occupation: string;
  phone: string;
  work_location: string;
  district: string;
  state: string;
  daily_wage: string;
  notes: string;
}

const EMPTY: FormState = {
  name: "",
  occupation: "",
  phone: "",
  work_location: "",
  district: "",
  state: "",
  daily_wage: "",
  notes: "",
};

export default function EmployersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [employers, setEmployers] = useState<Employer[] | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ employers: Employer[] }>("/employers");
      setEmployers(res.data.employers);
      setError("");
    } catch (err) {
      setEmployers([]);
      setError(apiErrorMessage(err, t("common.error")));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (field: keyof FormState, value: string) => setForm((f) => ({ ...f, [field]: value }));

  const submit = async () => {
    if (form.name.trim().length < 2) {
      setError(t("employers.nameRequired", "Please enter the employer's name."));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        occupation: form.occupation || null,
        phone: form.phone.trim() || null,
        work_location: form.work_location.trim() || null,
        district: form.district.trim() || null,
        state: form.state.trim() || null,
        daily_wage: form.daily_wage === "" ? null : Number(form.daily_wage),
        notes: form.notes.trim() || null,
      };

      if (editingId) {
        await api.patch(`/employers/${editingId}`, payload);
      } else {
        await api.post("/employers", payload);
      }

      setForm(EMPTY);
      setEditingId(null);
      setShowForm(false);
      await load();
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setError(t("employers.duplicate", "This employer is already in your list."));
      } else {
        setError(apiErrorMessage(err, t("common.error")));
      }
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (employer: Employer) => {
    setEditingId(employer.id);
    setShowForm(true);
    setForm({
      name: employer.name,
      occupation: employer.occupation ?? "",
      phone: employer.phone ?? "",
      work_location: employer.work_location ?? "",
      district: employer.district ?? "",
      state: employer.state ?? "",
      daily_wage: employer.daily_wage === null ? "" : String(employer.daily_wage),
      notes: employer.notes ?? "",
    });
  };

  const remove = async (employer: Employer) => {
    try {
      await api.delete(`/employers/${employer.id}`);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, t("common.error")));
    }
  };

  const totalOutstanding = (employers ?? []).reduce((sum, e) => sum + e.stats.total_outstanding, 0);

  return (
    <Screen title={t("employers.title", "Recurring employers")} onBack={true}>
      <div className="space-y-4 mt-4 pb-10">
        <Card className="!p-4 bg-blue-50 dark:bg-blue-900/20 border-blue-200">
          <p className="text-sm text-blue-900 dark:text-blue-100">
            {t(
              "employers.intro",
              "Keep a private list of the employers you work for often. Only you can see it, and the totals come from your own wage diary.",
            )}
          </p>
        </Card>

        {error && (
          <Card className="!p-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </Card>
        )}

        {(employers ?? []).length > 0 && (
          <Card className="!p-4">
            <p className="text-xs uppercase tracking-wide text-gray-400 font-semibold">
              {t("employers.totalOutstanding", "Outstanding across employers")}
            </p>
            <p className="text-xl font-bold text-brand-700 dark:text-brand-400">
              ₹{totalOutstanding}
            </p>
          </Card>
        )}

        {!showForm && (
          <Button
            icon={<Plus className="h-4 w-4" />}
            onClick={() => {
              setForm(EMPTY);
              setEditingId(null);
              setShowForm(true);
            }}
          >
            {t("employers.add", "Add an employer")}
          </Button>
        )}

        {showForm && (
          <Card className="!p-4 space-y-3">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">
              {editingId
                ? t("employers.edit", "Edit employer")
                : t("employers.add", "Add an employer")}
            </h2>

            <InputField
              label={t("employers.name", "Employer name")}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder={t("employers.namePlaceholder", "e.g. Ravi Constructions")}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t("employers.occupation", "Type of work")}
              </label>
              <select
                className="input-field"
                value={form.occupation}
                onChange={(e) => set("occupation", e.target.value)}
              >
                <option value="">{t("employers.occupationNone", "Not specified")}</option>
                {OCCUPATIONS.map((code) => (
                  <option key={code} value={code}>
                    {t(occupationLabelKey(code), code)}
                  </option>
                ))}
              </select>
            </div>

            <InputField
              label={t("employers.phoneOptional", "Phone (optional)")}
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              inputMode="tel"
            />

            <InputField
              label={t("employers.locationOptional", "Work site (optional)")}
              value={form.work_location}
              onChange={(e) => set("work_location", e.target.value)}
            />

            <div className="grid grid-cols-2 gap-3">
              <InputField
                label={t("employers.districtOptional", "District")}
                value={form.district}
                onChange={(e) => set("district", e.target.value)}
              />
              <InputField
                label={t("employers.stateOptional", "State")}
                value={form.state}
                onChange={(e) => set("state", e.target.value)}
              />
            </div>

            <InputField
              label={t("employers.dailyWageOptional", "Usual daily wage ₹ (optional)")}
              value={form.daily_wage}
              onChange={(e) => set("daily_wage", e.target.value)}
              inputMode="numeric"
            />

            <InputField
              label={t("employers.notesOptional", "Notes (optional)")}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />

            <div className="flex gap-2">
              <Button
                loading={saving}
                loadingText={t("common.loading")}
                onClick={() => void submit()}
              >
                {t("common.save")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                  setForm(EMPTY);
                }}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </Card>
        )}

        {employers === null ? (
          <SkeletonList rows={3} />
        ) : employers.length === 0 ? (
          <Card className="text-center py-8">
            <Building2 className="h-8 w-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t(
                "employers.empty",
                "No employers saved yet. Add one to track your work and unpaid wages.",
              )}
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {employers.map((employer) => (
              <Card key={employer.id} className="!p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {employer.name}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {[
                        employer.occupation
                          ? t(occupationLabelKey(employer.occupation), employer.occupation)
                          : null,
                        employer.work_location,
                        employer.district,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => startEdit(employer)}
                      aria-label={t("employers.edit", "Edit employer")}
                      className="p-2 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => void remove(employer)}
                      aria-label={t("common.delete", "Delete")}
                      className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <Stat
                    label={t("employers.days", "Days")}
                    value={String(employer.stats.days_worked)}
                  />
                  <Stat
                    label={t("employers.paid", "Paid")}
                    value={`₹${employer.stats.total_paid}`}
                  />
                  <Stat
                    label={t("employers.outstanding", "Unpaid")}
                    value={`₹${employer.stats.total_outstanding}`}
                    tone={employer.stats.total_outstanding > 0 ? "danger" : "success"}
                  />
                </div>

                {employer.phone && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">{employer.phone}</p>
                )}
                {employer.daily_wage !== null && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t("employers.usualWage", "Usual daily wage")}: ₹{employer.daily_wage}
                  </p>
                )}
                {employer.notes && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">{employer.notes}</p>
                )}

                <p className="text-[11px] text-gray-400 mt-3">
                  {t(
                    "employers.selfReported",
                    "You entered this yourself — ShramSetu has not verified it with the employer.",
                  )}
                </p>

                {employer.stats.total_outstanding > 0 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-3"
                    icon={<IndianRupee className="h-4 w-4" />}
                    onClick={() =>
                      // prefill keys match GrievanceFormPage's location.state contract
                      navigate("/worker/grievances/new", {
                        state: { category: "unpaid_wages", employer_name: employer.name },
                      })
                    }
                  >
                    {t("employers.fileUnpaid", "File unpaid wage complaint")}
                  </Button>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </Screen>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger" | "success";
}) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg py-2">
      <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">{label}</p>
      <p
        className={`text-sm font-bold ${
          tone === "danger"
            ? "text-red-600 dark:text-red-400"
            : tone === "success"
              ? "text-green-600 dark:text-green-400"
              : "text-gray-800 dark:text-gray-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
