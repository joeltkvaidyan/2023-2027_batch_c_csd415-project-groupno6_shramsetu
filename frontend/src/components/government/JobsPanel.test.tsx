/**
 * Applicant review contract for the government jobs panel.
 *
 * The office must be able to triage applications (ranked by an explainable
 * profile fit, shortlistable) without the screen implying that a shortlist is
 * an offer of work or leaking a phone number the worker did not share.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  getPostedJobs: vi.fn(),
  getJobApplicants: vi.fn(),
  reviewJobApplicant: vi.fn(),
  setJobStatus: vi.fn(),
  createJob: vi.fn(),
  t: (key: string, opts?: string | { defaultValue?: string; count?: number }) => {
    if (typeof opts === "string") return opts;
    if (opts && typeof opts === "object") {
      const template = opts.defaultValue ?? key;
      return template.replace(/\{\{count\}\}/g, String(opts.count ?? ""));
    }
    return key;
  },
}));

vi.mock("../../api/governmentClient", () => ({
  govGetPostedJobs: mocks.getPostedJobs,
  govGetJobApplicants: mocks.getJobApplicants,
  govReviewJobApplicant: mocks.reviewJobApplicant,
  govSetJobStatus: mocks.setJobStatus,
  govCreateJob: mocks.createJob,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: "en" } }),
}));

import JobsPanel from "./JobsPanel";

const JOB = {
  id: "job-1",
  title: "Mason for Thrissur site",
  description: "Six-storey project, wage paid weekly.",
  employer_name: "Thrissur Builders",
  occupation: "construction",
  state: "Kerala",
  district: "Thrissur",
  work_location: "Ollur",
  wage_min: 700,
  wage_max: 900,
  wage_period: "day" as const,
  work_type: "daily" as const,
  openings: 3,
  contact_phone: null,
  status: "open" as const,
  posted_by_department: "Labour Department",
  verification: "unverified" as const,
  created_at: "2026-10-18T00:00:00.000Z",
  applications_count: 2,
  shortlisted_count: 0,
};

const APPLICANT_CLOSE = {
  id: "app-1",
  job_id: "job-1",
  status: "submitted" as const,
  note: "Ten years on site",
  worker: {
    worker_code: "SS-100001",
    full_name: "Anil Kumar",
    occupation: "construction",
    district: "Ernakulam",
    state: "Kerala",
    contact_phone: null,
  },
  review: {
    score: 65,
    level: "good" as const,
    reasons: ["occupation_match", "same_state"] as const,
  },
  shortlisted: false,
  reviewed_at: null,
  created_at: "2026-10-19T00:00:00.000Z",
};

const APPLICANT_FAR = {
  id: "app-2",
  job_id: "job-1",
  status: "submitted" as const,
  note: null,
  worker: {
    worker_code: "SS-100002",
    full_name: "Meena Selvam",
    occupation: "hospitality",
    district: "Chennai",
    state: "Tamil Nadu",
    contact_phone: "9876500000",
  },
  review: {
    score: 0,
    level: "possible" as const,
    reasons: ["different_trade"] as const,
  },
  shortlisted: false,
  reviewed_at: null,
  created_at: "2026-10-19T01:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPostedJobs.mockResolvedValue({ jobs: [JOB] });
  mocks.getJobApplicants.mockResolvedValue({
    applications: [APPLICANT_CLOSE, APPLICANT_FAR],
    counts: { total: 2, shortlisted: 0 },
  });
});

describe("JobsPanel applicant review", () => {
  it("shows the fit the server ranked by, in server order", async () => {
    render(<JobsPanel token="t" />);
    await userEvent.click(await screen.findByText(/Review applicants/));

    const names = await screen.findAllByText(/Anil Kumar|Meena Selvam/);
    expect(names[0].textContent).toContain("Anil Kumar");
    expect(names[1].textContent).toContain("Meena Selvam");

    // Reasons are shown as words, not raw snake_case codes.
    expect(screen.getByText("occupation_match")).toBeTruthy();
    expect(screen.getByText("different_trade")).toBeTruthy();
    expect(screen.getByText(/It is not a rating of the worker/i)).toBeTruthy();
    // The disclaimer sits on every applicant card, so a review queue can never
    // be mistaken for a list of offers.
    expect(
      screen.getAllByText(/Shortlisting only records that this office read the application/i),
    ).toHaveLength(2);
  });

  it("does not invent a phone number the worker did not share", async () => {
    render(<JobsPanel token="t" />);
    await userEvent.click(await screen.findByText(/Review applicants/));

    expect(
      await screen.findByText(/Phone not shared — contact them through this office/),
    ).toBeTruthy();
    // The applicant who consented still shows their number.
    expect(screen.getByText(/9876500000/)).toBeTruthy();
    expect(screen.queryByText(/SS-100001.*9876/)).toBeNull();
  });

  it("shortlists through the API and reflects the new state", async () => {
    mocks.reviewJobApplicant.mockResolvedValue({
      ...APPLICANT_CLOSE,
      status: "shortlisted",
      shortlisted: true,
      reviewed_at: "2026-10-19T02:00:00.000Z",
    });

    render(<JobsPanel token="t" />);
    await userEvent.click(await screen.findByText(/Review applicants/));
    // One button per applicant; the first card is the top-ranked applicant.
    const shortlistButtons = await screen.findAllByText("Shortlist");
    await userEvent.click(shortlistButtons[0]);

    await waitFor(() =>
      expect(mocks.reviewJobApplicant).toHaveBeenCalledWith("t", "job-1", "app-1", "shortlisted"),
    );
    expect(await screen.findByText("Remove shortlist")).toBeTruthy();
  });

  it("filters the queue down to shortlisted applicants", async () => {
    mocks.getJobApplicants.mockResolvedValue({
      applications: [
        { ...APPLICANT_CLOSE, status: "shortlisted", shortlisted: true },
        APPLICANT_FAR,
      ],
      counts: { total: 2, shortlisted: 1 },
    });

    render(<JobsPanel token="t" />);
    await userEvent.click(await screen.findByText(/Review applicants/));
    await userEvent.click(await screen.findByRole("tab", { name: /Shortlisted \(1\)/ }));

    expect(screen.getByText(/Anil Kumar/)).toBeTruthy();
    expect(screen.queryByText(/Meena Selvam/)).toBeNull();
  });
});
