/**
 * The source chips are the trust moment of the assistant: a worker deciding
 * whether to act on an answer needs to know which government document it came
 * from. These tests pin the contract that each chip is a real button that
 * opens exactly one readable record at a time.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChatAnswerSource } from "../types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, second?: unknown, third?: unknown) => {
      const opts = typeof second === "object" && second !== null ? second : third;
      if (opts && typeof opts === "object") {
        return `${key}:${Object.values(opts as Record<string, string>).join("|")}`;
      }
      return key;
    },
  }),
}));

import { SourceChips } from "./SourceChips";

function source(overrides: Partial<ChatAnswerSource> = {}): ChatAnswerSource {
  return {
    title: "e-Shram registration",
    department: "Ministry of Labour and Employment",
    authority: "Government of India",
    last_updated: "2024-03-01",
    last_verified: "2024-04-10",
    version: "v2",
    source_url: "https://eshram.gov.in",
    source_file: "eshram.md",
    similarity: 0.91,
    ...overrides,
  };
}

describe("SourceChips", () => {
  it("renders nothing when there are no sources", () => {
    const { container } = render(<SourceChips sources={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one named button per source", () => {
    render(<SourceChips sources={[source(), source({ title: "PM-JAY", source_url: "" })]} />);
    expect(screen.getByRole("button", { name: /chat\.sourceDetailsLabel:e-Shram/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /chat\.sourceDetailsLabel:PM-JAY/ })).toBeVisible();
  });

  it("caps the visible chips at three", () => {
    render(
      <SourceChips
        sources={[source(), source({ title: "B" }), source({ title: "C" }), source({ title: "D" })]}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /Details for D/ })).toBeNull();
  });

  it("expands a chip into its record and collapses it again", async () => {
    const user = userEvent.setup();
    render(<SourceChips sources={[source()]} />);

    const chip = screen.getByRole("button", { name: /e-Shram/ });
    expect(chip).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region")).toBeNull();

    await user.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("region", { name: /e-Shram/ });
    expect(panel).toHaveTextContent("Ministry of Labour and Employment");
    expect(panel).toHaveTextContent("Government of India");
    expect(panel).toHaveTextContent("2024-03-01");
    expect(panel).toHaveTextContent("2024-04-10");
    expect(panel).toHaveTextContent("v2");
    expect(screen.getByRole("link", { name: "chat.sourceOpen" })).toHaveAttribute(
      "href",
      "https://eshram.gov.in",
    );

    await user.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("keeps only one record open at a time", async () => {
    const user = userEvent.setup();
    render(<SourceChips sources={[source(), source({ title: "PM-JAY", department: "Health" })]} />);

    await user.click(screen.getByRole("button", { name: /e-Shram/ }));
    await user.click(screen.getByRole("button", { name: /PM-JAY/ }));

    const panels = screen.getAllByRole("region");
    expect(panels).toHaveLength(1);
    expect(panels[0]).toHaveTextContent("Health");
    expect(screen.getByRole("button", { name: /e-Shram/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("hides unknown metadata and a missing link instead of printing 'Unknown'", async () => {
    const user = userEvent.setup();
    render(
      <SourceChips
        sources={[source({ authority: "Unknown", last_verified: "Unknown", source_url: "" })]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /e-Shram/ }));
    const panel = screen.getByRole("region");
    expect(panel).not.toHaveTextContent("Unknown");
    expect(screen.queryByRole("link")).toBeNull();
    expect(panel).toHaveTextContent("2024-03-01");
  });
});
