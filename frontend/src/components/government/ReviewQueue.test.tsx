/**
 * The labour office makes three decisions in one place now. These tests pin the
 * merge: one tab strip, one visible queue at a time, and the active tab wired
 * to its panel for keyboard/screen-reader users.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./ApprovalsPanel", () => ({ default: () => <div>worker-queue</div> }));
vi.mock("./EmployerApprovalsPanel", () => ({ default: () => <div>employer-queue</div> }));
vi.mock("./JobsPanel", () => ({ default: () => <div>jobs-panel</div> }));

import ReviewQueue from "./ReviewQueue";

describe("ReviewQueue", () => {
  it("opens on worker registrations with the other queues out of the way", () => {
    render(<ReviewQueue />);

    expect(screen.getByRole("tablist", { name: "Review queue" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: /Worker registrations/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("worker-queue")).toBeVisible();
    expect(screen.getByText("employer-queue")).not.toBeVisible();
    expect(screen.getByText("jobs-panel")).not.toBeVisible();
  });

  it("switches to employer registrations", async () => {
    const user = userEvent.setup();
    render(<ReviewQueue />);

    await user.click(screen.getByRole("tab", { name: /Employer registrations/ }));

    expect(screen.getByText("employer-queue")).toBeVisible();
    expect(screen.getByText("worker-queue")).not.toBeVisible();
    expect(screen.getByRole("tab", { name: /Employer registrations/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("switches to job listings", async () => {
    const user = userEvent.setup();
    render(<ReviewQueue />);

    await user.click(screen.getByRole("tab", { name: /Job listings/ }));

    expect(screen.getByText("jobs-panel")).toBeVisible();
    expect(screen.getByText("worker-queue")).not.toBeVisible();
  });

  it("labels the panel with its active tab", async () => {
    const user = userEvent.setup();
    render(<ReviewQueue />);

    await user.click(screen.getByRole("tab", { name: /Job listings/ }));

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", "review-tab-jobs");
    expect(screen.getByRole("tab", { name: /Job listings/ })).toHaveAttribute(
      "aria-controls",
      "review-panel-jobs",
    );
  });
});
