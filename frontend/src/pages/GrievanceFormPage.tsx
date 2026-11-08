import { FormEvent, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Screen } from "../components/Screen";
import { VoiceRecorder } from "../components/VoiceRecorder";
import { api, apiErrorDetail, httpStatus } from "../api/client";
import { submitOnce } from "../api/idempotency";
import {
  cacheGrievanceDraft,
  getCachedGrievanceDraft,
  deleteCachedGrievanceDraft,
} from "../services/offlineStorage";
import type { GrievanceCategory } from "../types";

const CATEGORIES: GrievanceCategory[] = [
  "unpaid_wages",
  "workplace_safety",
  "harassment_abuse",
  "illegal_termination",
  "document_issue",
  "employer_dispute",
  "insurance_claim",
  "accommodation",
  "other",
];

export default function GrievanceFormPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  // Optional prefill passed via navigate(..., { state }) — e.g. the Wage
  // Diary's complaint buttons land here with the category, subject,
  // description, the worker's logged work date and the employer already
  // filled in.
  const state = useLocation().state as {
    category?: string;
    subject?: string;
    description?: string;
    incident_date?: string;
    employer_name?: string;
    // Platform records cited by the draft (wage slips / confirmed
    // engagements) — attached through the same attachments array.
    evidence?: { kind: string; ref_id: string; label?: string }[];
  } | null;
  const prefillCategory = CATEGORIES.includes(state?.category as GrievanceCategory)
    ? (state?.category as GrievanceCategory)
    : "unpaid_wages";

  const [category, setCategory] = useState<GrievanceCategory>(prefillCategory);
  const [subject, setSubject] = useState(state?.subject ?? "");
  const [description, setDescription] = useState(state?.description ?? "");
  const [employerName, setEmployerName] = useState(state?.employer_name ?? "");
  const [incidentLocation, setIncidentLocation] = useState("");
  const [incidentDate, setIncidentDate] = useState(state?.incident_date ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ subject?: string; description?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Load draft if no prefill state
    if (!state) {
      getCachedGrievanceDraft().then((draft) => {
        if (draft) {
          setCategory(draft.category as GrievanceCategory);
          setSubject(draft.subject);
          setDescription(draft.description);
          setEmployerName(draft.employer_name || "");
          setIncidentLocation(draft.incident_location || "");
          setIncidentDate(draft.incident_date || "");
        }
      });
    }
  }, [state]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (subject.trim() || description.trim()) {
        await cacheGrievanceDraft({
          subject,
          description,
          category,
          employer_name: employerName,
          incident_location: incidentLocation,
          incident_date: incidentDate,
        });
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [category, subject, description, employerName, incidentLocation, incidentDate]);

  const validate = () => {
    const errs: { subject?: string; description?: string } = {};
    if (!subject.trim()) errs.subject = t("common.required");
    if (!description.trim()) errs.description = t("common.required");
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // One key per submission: a retry after a lost reply must not file the same
  // complaint twice. It is cleared only by a successful response.
  const submissionKey = useRef<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await submitOnce(
        submissionKey,
        {
          category,
          subject,
          description,
          employer_name: employerName || undefined,
          incident_location: incidentLocation || undefined,
          incident_date: incidentDate ? new Date(incidentDate).toISOString() : undefined,
          // Server re-checks every reference against the worker and drops any
          // that is not theirs; a stale id never blocks the filing.
          evidence: state?.evidence?.length ? state.evidence : undefined,
        },
        (body) => api.post("/grievances", body),
      );
      await deleteCachedGrievanceDraft();
      navigate(`/worker/grievances/${res.data.id}`, { replace: true });
    } catch (err) {
      // Surface FastAPI/Pydantic 422 field errors inline near the actual
      // field instead of only a generic banner — falls back to the banner
      // for anything that isn't a recognized field-level error (network
      // failure, 500, etc.).
      const detail = apiErrorDetail(err);
      if (httpStatus(err) === 422 && Array.isArray(detail)) {
        const next: { subject?: string; description?: string } = {};
        let unmapped = false;
        for (const item of detail) {
          const field = item?.loc?.[item.loc.length - 1];
          if (field === "subject" || field === "description") {
            next[field as "subject" | "description"] = t("common.required");
          } else {
            unmapped = true;
          }
        }
        setFieldErrors(next);
        if (unmapped || Object.keys(next).length === 0) setError(t("common.error"));
      } else {
        setError(t("common.error"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleVoiceSubject = (text: string) => {
    setSubject((prev) => (prev ? prev + " " + text : text));
  };

  const handleVoiceDescription = (text: string) => {
    setDescription((prev) => (prev ? prev + " " + text : text));
  };

  return (
    <Screen title={t("grievance.fileNew")} onBack={true}>
      <form onSubmit={handleSubmit} noValidate className="space-y-4 mt-4 pb-10">
        <div>
          <label
            htmlFor="grievance-category"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {t("grievance.category")}
          </label>
          <select
            id="grievance-category"
            className="input-field"
            value={category}
            onChange={(e) => setCategory(e.target.value as GrievanceCategory)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`grievance.categories.${c}`)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="grievance-subject"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {t("grievance.subject")}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="grievance-subject"
              maxLength={200}
              aria-invalid={!!fieldErrors.subject}
              aria-describedby={fieldErrors.subject ? "subject-error" : undefined}
              className={`input-field flex-1 ${fieldErrors.subject ? "input-error" : ""}`}
              placeholder={t("grievance.subjectPlaceholder")}
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                if (fieldErrors.subject) setFieldErrors((f) => ({ ...f, subject: undefined }));
              }}
            />
            <VoiceRecorder language={i18n.language} onTranscript={handleVoiceSubject} />
          </div>
          {fieldErrors.subject && (
            <p id="subject-error" role="alert" className="field-error">
              {fieldErrors.subject}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="grievance-description"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {t("grievance.description")}
          </label>
          <textarea
            id="grievance-description"
            rows={5}
            aria-invalid={!!fieldErrors.description}
            aria-describedby={fieldErrors.description ? "description-error" : undefined}
            className={`input-field resize-none ${fieldErrors.description ? "input-error" : ""}`}
            placeholder={t("grievance.descriptionPlaceholder")}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              if (fieldErrors.description)
                setFieldErrors((f) => ({ ...f, description: undefined }));
            }}
          />
          {fieldErrors.description && (
            <p id="description-error" role="alert" className="field-error">
              {fieldErrors.description}
            </p>
          )}
          <div className="flex justify-end mt-1">
            <VoiceRecorder language={i18n.language} onTranscript={handleVoiceDescription} />
          </div>
        </div>

        <div>
          <label
            htmlFor="grievance-employer-name"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {t("grievance.employerNameOptional")}
          </label>
          <input
            id="grievance-employer-name"
            className="input-field"
            value={employerName}
            onChange={(e) => setEmployerName(e.target.value)}
          />
        </div>

        <div>
          <label
            htmlFor="grievance-incident-location"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {t("grievance.incidentLocationOptional")}
          </label>
          <input
            id="grievance-incident-location"
            className="input-field"
            value={incidentLocation}
            onChange={(e) => setIncidentLocation(e.target.value)}
          />
        </div>

        <div>
          <label
            htmlFor="grievance-incident-date"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {t("grievance.incidentDateOptional")}
          </label>
          <input
            id="grievance-incident-date"
            type="date"
            className="input-field"
            value={incidentDate}
            onChange={(e) => setIncidentDate(e.target.value)}
          />
        </div>

        {error && (
          <p
            role="alert"
            className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3"
          >
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting} className="btn-primary mt-2">
          {submitting ? t("grievance.submitting") : t("grievance.submit")}
        </button>
      </form>
    </Screen>
  );
}
