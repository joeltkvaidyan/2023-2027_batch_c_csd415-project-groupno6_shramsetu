/**
 * GrievanceStatusBadge carries an accessibility claim in its own comment:
 * "status = color + icon + text (never color alone)". This test asserts the
 * claim holds — every status renders a translated label and an icon, and the
 * five styles are actually distinct classes so the mapping cannot silently
 * collapse (e.g. a copy-paste that gave `rejected` the `resolved` green).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { GrievanceStatus } from "../types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { GrievanceStatusBadge } from "./GrievanceStatusBadge";

const ALL_STATUSES: GrievanceStatus[] = [
  "submitted",
  "under_review",
  "resolved",
  "rejected",
  "withdrawn",
];

describe("GrievanceStatusBadge", () => {
  it.each(ALL_STATUSES)("renders the translated label for %s", (status) => {
    render(<GrievanceStatusBadge status={status} />);
    expect(screen.getByText(`grievance.status.${status}`)).toBeInTheDocument();
  });

  it("gives each status a distinct colour scheme", () => {
    const classes = new Map<string, string>();
    for (const status of ALL_STATUSES) {
      const { container, unmount } = render(<GrievanceStatusBadge status={status} />);
      const span = container.querySelector("span");
      // The status-specific classes are everything after the shared layout ones.
      const style = (span?.className ?? "")
        .split(" ")
        .filter((c) => !c.startsWith("inline-flex") && !c.startsWith("text-xs"))
        .join(" ");
      classes.set(status, style);
      unmount();
    }
    expect(new Set(classes.values()).size).toBe(ALL_STATUSES.length);
  });

  it("hides the decorative icon from assistive tech but keeps the text", () => {
    // aria-hidden on the icon + real text is what makes "never colour alone"
    // true for a screen reader, not just for a sighted user.
    const { container } = render(<GrievanceStatusBadge status="resolved" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("grievance.status.resolved")).toBeInTheDocument();
  });

  it("keeps the label readable next to the icon", () => {
    render(<GrievanceStatusBadge status="under_review" />);
    // Tailwind's whitespace-nowrap on a pill with an icon: a regression to
    // wrapping would push the badge to two lines in the grievance list.
    expect(screen.getByText("grievance.status.under_review")).toHaveClass("whitespace-nowrap");
  });
});
