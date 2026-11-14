/**
 * The dock is the only way to reach some screens, so its contract is worth a
 * test: exactly five labelled destinations that fit a phone, every label present
 * as text (not an icon alone), and an unread badge that is announced rather than
 * being a red dot with no words.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const get = vi.fn();
vi.mock("../api/client", () => ({ api: { get: (...args: unknown[]) => get(...args) } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

import { BottomNav } from "./BottomNav";

const renderNav = (path = "/worker/dashboard") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <BottomNav />
    </MemoryRouter>,
  );

describe("BottomNav", () => {
  beforeEach(() => {
    get.mockResolvedValue({ data: { unread_count: 0 } });
  });

  it("offers exactly five destinations, each with a visible label", () => {
    renderNav();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(5);
    // These are the component's own short fallbacks; the real six-language
    // labels are covered by the locale parity gate, not by this mock.
    for (const label of ["Home", "Wages", "Docs", "Grievance", "Alerts"]) {
      expect(screen.getByRole("link", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }
  });

  it("keeps the inbox reachable, since nothing else links to it", () => {
    renderNav();
    expect(screen.getByRole("link", { name: /alerts/i })).toHaveAttribute(
      "href",
      "/worker/notifications",
    );
  });

  it("marks the current tab for assistive tech", () => {
    renderNav("/worker/wages");
    expect(screen.getByRole("link", { name: /wages/i })).toHaveAttribute("aria-current", "page");
  });

  it("shows the unread count and reads out the exact number", async () => {
    get.mockResolvedValue({ data: { unread_count: 7 } });
    renderNav();
    await waitFor(() => expect(screen.getByText("7")).toBeInTheDocument());
  });

  it("keeps the dock usable when the count cannot be loaded", () => {
    get.mockRejectedValue(new Error("offline"));
    renderNav();
    expect(screen.getAllByRole("link")).toHaveLength(5);
  });
});
