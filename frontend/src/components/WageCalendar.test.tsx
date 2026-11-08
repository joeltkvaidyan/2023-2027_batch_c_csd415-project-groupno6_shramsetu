/**
 * The calendar is the page a worker consults to prove what they are owed, so the
 * arithmetic is tested directly: a grid that is off by one day, or that renders
 * UTC midnight in a timezone behind UTC, misdates the very evidence a complaint
 * rests on.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WageEntry } from "../types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.values(opts).join("|")}` : key,
    i18n: { language: "en" },
  }),
}));

import { WageCalendar, buildMonthGrid, formatMonthLabel } from "./WageCalendar";
import en from "../i18n/locales/en.json";

function entry(work_date: string, status: WageEntry["payment_status"]): WageEntry {
  return {
    id: `w-${work_date}`,
    work_date,
    employer_name: null,
    agreed_amount: 600,
    paid_amount: status === "paid" ? 600 : status === "partial" ? 200 : 0,
    payment_status: status,
  } as WageEntry;
}

describe("buildMonthGrid", () => {
  it("starts the 1st under the right weekday", () => {
    // February 2026 begins on a Sunday, so no blank cells precede it.
    const grid = buildMonthGrid("2026-02", []);
    expect(grid[0]).not.toBeNull();
    expect(grid[0]?.dayNumber).toBe(1);

    // March 2026 begins on a Sunday too; May 2026 begins on a Friday (5 blanks).
    const may = buildMonthGrid("2026-05", []);
    expect(may.slice(0, 5).every((cell) => cell === null)).toBe(true);
    expect(may[5]?.dayNumber).toBe(1);
  });

  it("knows how long each month is, including a leap February", () => {
    // Count the day cells, not the array: leading blanks are part of the grid.
    const days = (month: string) => buildMonthGrid(month, []).filter(Boolean).length;
    expect(days("2026-02")).toBe(28);
    expect(days("2028-02")).toBe(29);
    expect(days("2026-04")).toBe(30);
    expect(days("2026-12")).toBe(31);
  });

  it("matches entries to days regardless of the stored timestamp", () => {
    // The API stores "2026-03-09T00:00:00Z"; slicing must not shift the day.
    const grid = buildMonthGrid("2026-03", [entry("2026-03-09T00:00:00Z", "paid")]);
    const ninth = grid.find((cell) => cell?.iso === "2026-03-09");
    expect(ninth?.entry?.payment_status).toBe("paid");
  });

  it("returns nothing for a month it cannot parse instead of throwing", () => {
    expect(buildMonthGrid("", [])).toEqual([]);
  });
});

describe("formatMonthLabel", () => {
  it("names the month instead of printing the ISO string", () => {
    expect(formatMonthLabel("2026-11", "en")).toBe("November 2026");
    expect(formatMonthLabel("2026-01", "en")).toBe("January 2026");
  });

  it("does not drift a month at the year boundary", () => {
    expect(formatMonthLabel("2026-12", "en")).toContain("December");
    expect(formatMonthLabel("2027-01", "en")).toContain("January");
    expect(formatMonthLabel("2027-01", "en")).toContain("2027");
  });

  it("localises the month name", () => {
    expect(formatMonthLabel("2026-11", "hi")).not.toBe("November 2026");
  });
});

/**
 * The component's own i18n mock elsewhere in this file returns the keys, which
 * would hide a broken placeholder — a double-braced "{{date}}" renders to the
 * user as literal text and still looks fine to a mock. So this one renders the
 * REAL English catalogue through the REAL interpolation config (single braces).
 */
describe("WageCalendar with the real English catalogue", () => {
  it("fills every placeholder in the calendar strings", () => {
    const t = (key: string, opts?: Record<string, unknown>) => {
      const value = key
        .split(".")
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en);
      if (typeof value !== "string") return key;
      return value.replace(/{([a-zA-Z0-9_]+)}/g, (whole, name) =>
        opts && name in opts ? String(opts[name]) : whole,
      );
    };
    const rendered = t("wages.cellLabel", {
      date: "2026-03-05",
      status: "Partial",
      agreed: "₹600",
      paid: "₹200",
    });
    expect(rendered).toBe("2026-03-05: Partial, ₹600 agreed, ₹200 paid");
    expect(rendered).not.toContain("{");

    for (const key of ["wages.calendarLabel", "wages.cellEmpty", "wages.cellLabel"]) {
      const value = key
        .split(".")
        .reduce<unknown>((n, p) => (n as Record<string, unknown>)?.[p], en);
      expect(typeof value).toBe("string");
      expect(value as string).not.toContain("{{");
    }
  });
});

describe("WageCalendar", () => {
  const month = "2026-03";

  it("labels every square with the amount, not just a colour", () => {
    render(
      <WageCalendar
        month={month}
        entries={[entry("2026-03-05", "partial")]}
        onSelectDay={() => {}}
      />,
    );
    const cell = screen.getByRole("button", { name: /2026-03-05/ });
    expect(cell).toHaveAccessibleName(/wages\.status\.partial/);
    expect(cell).toHaveAccessibleName(/₹600/);
    expect(cell).toHaveAccessibleName(/₹200/);
  });

  it("says an empty day has no entry rather than leaving it silent", () => {
    render(<WageCalendar month={month} entries={[]} onSelectDay={() => {}} />);
    expect(screen.getByRole("button", { name: /2026-03-02/ })).toHaveAccessibleName(
      /wages\.cellEmpty/,
    );
  });

  it("marks the day already in the form", () => {
    render(
      <WageCalendar month={month} entries={[]} selectedDay="2026-03-11" onSelectDay={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /2026-03-11/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("hands the tapped day back to the form", async () => {
    const onSelectDay = vi.fn();
    render(<WageCalendar month={month} entries={[]} onSelectDay={onSelectDay} />);
    await userEvent.click(screen.getByRole("button", { name: /2026-03-17/ }));
    expect(onSelectDay).toHaveBeenCalledWith("2026-03-17");
  });

  it("lets a screen reader hear the weekday headers instead of hiding them", () => {
    render(<WageCalendar month={month} entries={[]} onSelectDay={() => {}} />);
    // Every column header must be readable: naming the weekday once per row
    // used to be worth nothing because the headers were aria-hidden.
    for (const name of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      expect(screen.getByText(name)).not.toHaveAttribute("aria-hidden", "true");
    }
  });

  it("carries the weekday inside each day button's own label", () => {
    // 2026-03-05 falls on a Thursday, and a screen reader sweeping button by
    // button never pairs a cell with the header above it.
    render(
      <WageCalendar
        month={month}
        entries={[entry("2026-03-05", "partial")]}
        onSelectDay={() => {}}
      />,
    );
    const cell = screen.getByRole("button", { name: /Thursday 2026-03-05/ });
    expect(cell).toHaveAccessibleName(/₹600/);
  });

  it("explains its icons in a legend, so the meaning is not colour-only", () => {
    render(<WageCalendar month={month} entries={[]} onSelectDay={() => {}} />);
    for (const status of ["paid", "partial", "unpaid"]) {
      expect(screen.getByText(`wages.status.${status}`)).toBeInTheDocument();
    }
  });
});
