/**
 * Phase 2 screen contracts.
 *
 * These assert the parts a worker can be misled by: a job card must always
 * carry the "not verified / never pay a fee" wording plus explainable match
 * reasons, and an employer record must always say it is self-reported. The API
 * client is mocked so the tests describe the screens, not the network.
 */
import type { ReactElement } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
  // Stable identity like the real react-i18next `t`: pages key their data
  // loading on `t`, so a new function per render would refetch forever.
  t: (key: string, fallback?: string) => fallback ?? key,
}));

vi.mock("../api/client", () => ({
  api: mocks,
  apiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: "en" } }),
}));

import JobsPage from "./JobsPage";
import EmployersPage from "./EmployersPage";

const renderPage = (ui: ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

const JOB = {
  id: "job-1",
  title: "Mason required for apartment site",
  description: "Six-storey apartment project, wage paid weekly.",
  employer_name: "Ravi Constructions",
  occupation: "construction",
  state: "Kerala",
  district: "Ernakulam",
  work_location: "Kakkanad",
  wage_min: 700,
  wage_max: 900,
  wage_period: "day" as const,
  work_type: "daily" as const,
  openings: 4,
  contact_phone: "9876543210",
  status: "open" as const,
  posted_by_department: "Labour Department",
  verification: "unverified" as const,
  created_at: "2026-10-18T00:00:00.000Z",
  updated_at: "2026-10-18T00:00:00.000Z",
  match: { score: 95, level: "strong" as const, reasons: ["occupation_match", "same_district"] },
  applied: false,
};

beforeEach(() => {
  mocks.get.mockReset();
  mocks.post.mockReset();
  mocks.delete.mockReset();
});

describe("JobsPage", () => {
  beforeEach(() => {
    mocks.get.mockImplementation((url: string) => {
      if (url === "/jobs") return Promise.resolve({ data: { jobs: [JOB] } });
      if (url === "/jobs/applications/mine") return Promise.resolve({ data: { applications: [] } });
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
  });

  it("warns that listings are unverified and never to pay a fee", async () => {
    renderPage(<JobsPage />);
    expect(
      await screen.findByText(/ShramSetu does not verify the employer or the wage/i)
    ).toBeTruthy();
  });

  it("explains why a listing matched instead of only showing a score", async () => {
    renderPage(<JobsPage />);
    expect(await screen.findByText("Mason required for apartment site")).toBeTruthy();
    expect(screen.getByText("occupation_match")).toBeTruthy();
    expect(screen.getByText("same_district")).toBeTruthy();
    // level chip falls back to the raw level word when a locale lacks the key
    expect(screen.getByText("strong")).toBeTruthy();
  });

  it("offers both apply paths, including explicit contact sharing", async () => {
    renderPage(<JobsPage />);
    await screen.findByText("Mason required for apartment site");
    expect(screen.getByText("I am interested")).toBeTruthy();
    expect(screen.getByText("Interested + share my number")).toBeTruthy();

    await userEvent.click(screen.getByText("I am interested"));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/jobs/job-1/apply", { share_contact: false })
    );
  });

  it("shows applied listings as withdrawable rather than applyable again", async () => {
    mocks.get.mockImplementation((url: string) => {
      if (url === "/jobs") return Promise.resolve({ data: { jobs: [{ ...JOB, applied: true }] } });
      if (url === "/jobs/applications/mine") {
        return Promise.resolve({ data: { applications: [{ id: "a1", job_id: "job-1", status: "submitted", note: null, share_contact: false, created_at: "2026-10-18T00:00:00.000Z", updated_at: "2026-10-18T00:00:00.000Z" }] } });
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });

    renderPage(<JobsPage />);
    expect(await screen.findByText("Applied")).toBeTruthy();
    expect(screen.getByText("Withdraw")).toBeTruthy();
    expect(screen.queryByText("I am interested")).toBeNull();
  });
});

describe("EmployersPage", () => {
  const EMPLOYER = {
    id: "emp-1",
    name: "Ravi Constructions",
    occupation: "construction",
    phone: "9876543210",
    work_location: "Kakkanad",
    district: "Ernakulam",
    state: "Kerala",
    daily_wage: 800,
    notes: null,
    is_active: true,
    self_reported: true as const,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-02T00:00:00.000Z",
    stats: {
      days_worked: 2,
      total_agreed: 1600,
      total_paid: 1300,
      total_outstanding: 300,
      last_worked_on: "2026-10-02T00:00:00.000Z",
    },
  };

  beforeEach(() => {
    mocks.get.mockImplementation((url: string) => {
      if (url === "/employers") return Promise.resolve({ data: { employers: [EMPLOYER] } });
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
  });

  it("keeps the record explicitly self-reported", async () => {
    renderPage(<EmployersPage />);
    expect(await screen.findByText("Ravi Constructions")).toBeTruthy();
    expect(
      screen.getByText(/You entered this yourself — ShramSetu has not verified it with the employer/i)
    ).toBeTruthy();
  });

  it("shows wage totals derived from the worker's own diary", async () => {
    renderPage(<EmployersPage />);
    await screen.findByText("Ravi Constructions");
    expect(screen.getByText("₹1300")).toBeTruthy();
    // ₹300 shows twice: the total across employers and this employer's unpaid
    expect(screen.getAllByText("₹300").length).toBeGreaterThanOrEqual(2);
  });

  it("refuses to save an employer with no name", async () => {
    renderPage(<EmployersPage />);
    await screen.findByText("Ravi Constructions");

    await userEvent.click(screen.getByText("Add an employer"));
    await userEvent.click(screen.getByText("common.save"));

    expect(
      await screen.findByText("Please enter the employer's name.")
    ).toBeTruthy();
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
