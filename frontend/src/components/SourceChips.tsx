import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ExternalLink, FileText } from "lucide-react";
import type { ChatAnswerSource } from "../types";

/**
 * One chip per retrieved government document. The chip is a button, not a
 * label: a worker who wants to know *why* the assistant is confident can open
 * the record and read the department, the update date, and the official link
 * without leaving the conversation.
 */
export function SourceChips({ sources }: { sources: ChatAnswerSource[] }) {
  const { t } = useTranslation();
  const baseId = useId();
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const visible = sources.slice(0, 3);
  const active = openIdx === null ? null : visible[openIdx];

  if (visible.length === 0) return null;

  const labelFor = (s: ChatAnswerSource) => s.title ?? s.source_file ?? t("chat.sources");

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
        <FileText className="h-3 w-3" aria-hidden="true" />
        {t("chat.sources", "Sources")}
      </p>
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label={t("chat.sources", "Sources")}
      >
        {visible.map((s, i) => {
          const open = openIdx === i;
          const panelId = `${baseId}-source-${i}`;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setOpenIdx(open ? null : i)}
              aria-expanded={open}
              aria-controls={open ? panelId : undefined}
              aria-label={t("chat.sourceDetailsLabel", "Details for {title}", {
                title: labelFor(s),
              })}
              className={`inline-flex items-center gap-1.5 max-w-full overflow-hidden text-[11px] font-medium rounded-full pl-1.5 pr-2 py-1 border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                open
                  ? "bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700"
                  : "bg-gray-50 dark:bg-gray-900/60 border-gray-100 dark:border-gray-700 hover:border-brand-300"
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-brand-100 dark:bg-brand-900/60 text-brand-700 dark:text-brand-300 flex items-center justify-center text-[10px] font-bold shrink-0">
                {i + 1}
              </span>
              <FileText className="h-3 w-3 text-gray-400 shrink-0" aria-hidden="true" />
              <span className="truncate text-gray-700 dark:text-gray-300">{labelFor(s)}</span>
              <ChevronDown
                className={`h-3 w-3 text-gray-400 shrink-0 transition-transform ${
                  open ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>

      {active && (
        <div
          id={`${baseId}-source-${openIdx}`}
          role="region"
          aria-label={t("chat.sourceDetailsLabel", "Details for {title}", {
            title: labelFor(active),
          })}
          className="rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/60 px-3 py-2 text-left animate-fade"
        >
          <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 break-words">
            {labelFor(active)}
          </p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] text-gray-600 dark:text-gray-300">
            {active.department && (
              <>
                <dt className="font-medium text-gray-400">{t("chat.department")}</dt>
                <dd className="break-words">{active.department}</dd>
              </>
            )}
            {active.authority && active.authority !== "Unknown" && (
              <>
                <dt className="font-medium text-gray-400">{t("chat.sourceAuthority")}</dt>
                <dd className="break-words">{active.authority}</dd>
              </>
            )}
            {active.last_updated && active.last_updated !== "Unknown" && (
              <>
                <dt className="font-medium text-gray-400">{t("chat.lastUpdated")}</dt>
                <dd>{active.last_updated}</dd>
              </>
            )}
            {active.last_verified && active.last_verified !== "Unknown" && (
              <>
                <dt className="font-medium text-gray-400">{t("chat.sourceVerified")}</dt>
                <dd>{active.last_verified}</dd>
              </>
            )}
            {active.version && (
              <>
                <dt className="font-medium text-gray-400">{t("chat.sourceVersion")}</dt>
                <dd>{active.version}</dd>
              </>
            )}
          </dl>
          {active.source_url && (
            <a
              href={active.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 dark:text-brand-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
            >
              {t("chat.sourceOpen")}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
