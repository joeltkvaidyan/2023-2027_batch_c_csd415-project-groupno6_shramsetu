/**
 * The complaint form is now three short screens instead of one long scroll.
 * These tests pin the rules that make that safe: a worker cannot move past a
 * screen that still needs an answer, and whatever they typed is written to the
 * offline draft between keystrokes.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../components/VoiceRecorder", () => ({ VoiceRecorder: () => null }));

const cacheGrievanceDraft = vi.fn(async (_draft: GrievanceDraft) => {});
const getCachedGrievanceDraft = vi.fn(async (): Promise<GrievanceDraft | null> => null);
vi.mock("../services/offlineStorage", () => ({
  cacheGrievanceDraft: (draft: GrievanceDraft) => cacheGrievanceDraft(draft),
  getCachedGrievanceDraft: () => getCachedGrievanceDraft(),
  deleteCachedGrievanceDraft: vi.fn(async () => {}),
  addToSyncQueue: vi.fn(async () => {}),
}));

vi.mock("../api/client", () => ({
  api: { post: vi.fn() },
  apiErrorDetail: vi.fn(() => ""),
  httpStatus: vi.fn(() => 0),
  isNetworkFailure: vi.fn(() => false),
}));
vi.mock("../api/idempotency", () => ({ submitOnce: vi.fn() }));

import GrievanceFormPage from "./GrievanceFormPage";
import type { GrievanceDraft } from "../services/offlineStorage";

function renderForm() {
  return render(
    <MemoryRouter>
      <GrievanceFormPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cacheGrievanceDraft.mockClear();
  getCachedGrievanceDraft.mockClear();
  getCachedGrievanceDraft.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GrievanceFormPage steps", () => {
  it("opens on one screen with only the category and subject", () => {
    renderForm();
    expect(screen.getByLabelText("grievance.category")).toBeInTheDocument();
    expect(screen.getByLabelText("grievance.subject")).toBeInTheDocument();
    expect(screen.queryByLabelText("grievance.description")).toBeNull();
    expect(screen.queryByLabelText("grievance.incidentDateOptional")).toBeNull();
    expect(screen.getByRole("button", { name: "grievance.next" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "common.back" })).toBeNull();
    expect(screen.getByText(/grievance\.stepOf/)).toHaveTextContent('"current":1');
  });

  it("refuses to advance while the subject is empty", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "grievance.next" }));
    expect(screen.getByRole("alert")).toHaveTextContent("common.required");
    expect(screen.queryByLabelText("grievance.description")).toBeNull();
    expect(screen.getByLabelText("grievance.subject")).toHaveAttribute("aria-invalid", "true");
  });

  it("walks subject → description → where and when", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("grievance.subject"), "Wages not paid");
    await user.click(screen.getByRole("button", { name: "grievance.next" }));

    expect(screen.getByLabelText("grievance.description")).toBeInTheDocument();
    expect(screen.queryByLabelText("grievance.subject")).toBeNull();
    expect(screen.getByText(/grievance\.stepOf/)).toHaveTextContent('"current":2');
    expect(screen.getByRole("button", { name: "common.back" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("grievance.description"), "Three days unpaid");
    await user.click(screen.getByRole("button", { name: "grievance.next" }));

    expect(screen.getByLabelText("grievance.incidentDateOptional")).toBeInTheDocument();
    expect(screen.queryByLabelText("grievance.description")).toBeNull();
    expect(screen.getByRole("button", { name: "grievance.submit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "grievance.next" })).toBeNull();
  });

  it("goes back without losing what was typed", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("grievance.subject"), "Wages not paid");
    await user.click(screen.getByRole("button", { name: "grievance.next" }));
    await user.click(screen.getByRole("button", { name: "common.back" }));

    expect(screen.getByLabelText("grievance.subject")).toHaveValue("Wages not paid");
  });

  it("autosaves the draft after typing, and says so", async () => {
    renderForm();

    fireEvent.change(screen.getByLabelText("grievance.subject"), {
      target: { value: "Wages not paid" },
    });

    await waitFor(() => expect(cacheGrievanceDraft).toHaveBeenCalled(), { timeout: 2000 });
    expect(cacheGrievanceDraft.mock.calls.at(-1)?.[0]).toMatchObject({
      subject: "Wages not paid",
      category: "unpaid_wages",
    });
    expect(await screen.findByText("grievance.draftSaved")).toBeInTheDocument();
  });

  it("restores an autosaved draft when the worker comes back", async () => {
    getCachedGrievanceDraft.mockResolvedValue({
      subject: "Saved subject",
      description: "Saved details",
      category: "workplace_safety",
      employer_name: "",
      incident_location: "",
      incident_date: "",
    });
    renderForm();

    await waitFor(() =>
      expect(screen.getByLabelText("grievance.subject")).toHaveValue("Saved subject"),
    );
    expect(screen.getByLabelText("grievance.category")).toHaveValue("workplace_safety");
  });
});
