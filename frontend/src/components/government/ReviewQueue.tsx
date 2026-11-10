import { useState } from "react";
import { Briefcase, Building2, UserCheck } from "lucide-react";
import ApprovalsPanel from "./ApprovalsPanel";
import EmployerApprovalsPanel from "./EmployerApprovalsPanel";
import JobsPanel from "./JobsPanel";

type Queue = "workers" | "employers" | "jobs";

const QUEUES: {
  key: Queue;
  label: string;
  hint: string;
  icon: typeof UserCheck;
}[] = [
  {
    key: "workers",
    label: "Worker registrations",
    hint: "Accept or reject new worker sign-ups",
    icon: UserCheck,
  },
  {
    key: "employers",
    label: "Employer registrations",
    hint: "Review employers before they can post",
    icon: Building2,
  },
  {
    key: "jobs",
    label: "Job listings",
    hint: "Publish work and review applicants",
    icon: Briefcase,
  },
];

/**
 * The three decisions a labour office makes every day — admitting a worker,
 * admitting an employer, and reviewing job listings — belong to one queue,
 * not three top-level tabs. On a wide screen the queues become a side rail so
 * the working area gets the height and width it needs; on a phone the same
 * rail collapses into a swipeable row of tabs.
 */
export default function ReviewQueue() {
  const [queue, setQueue] = useState<Queue>("workers");

  return (
    <div className="xl:flex xl:items-start xl:gap-6">
      <div
        role="tablist"
        aria-label="Review queue"
        className="flex gap-2 overflow-x-auto pb-1 xl:w-64 xl:shrink-0 xl:flex-col xl:overflow-visible xl:pb-0"
      >
        {QUEUES.map(({ key, label, hint, icon: Icon }) => {
          const selected = key === queue;
          return (
            <button
              key={key}
              id={`review-tab-${key}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`review-panel-${key}`}
              onClick={() => setQueue(key)}
              className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 xl:w-full xl:px-4 xl:py-3 ${
                selected
                  ? "border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-700 dark:bg-brand-900/30 dark:text-brand-200"
                  : "border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-600 hover:bg-slate-700"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="whitespace-nowrap xl:whitespace-normal">
                {label}
                <span className="mt-0.5 hidden text-xs font-normal opacity-70 xl:block">
                  {hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 min-w-0 flex-1 xl:mt-0">
        {QUEUES.map(({ key }) => (
          <section
            key={key}
            id={`review-panel-${key}`}
            role="tabpanel"
            aria-labelledby={`review-tab-${key}`}
            hidden={key !== queue}
            className="min-w-0"
          >
            {key === "workers" && <ApprovalsPanel />}
            {key === "employers" && <EmployerApprovalsPanel />}
            {key === "jobs" && <JobsPanel />}
          </section>
        ))}
      </div>
    </div>
  );
}
