/**
 * The UI kit's tests are about the behaviour that is invisible in a screenshot:
 * a status that is still readable without colour, a dialog the keyboard cannot
 * walk out of, a field whose error is announced, and a toast that does not
 * interrupt. Those are the parts that break silently and hurt a worker using a
 * screen reader or a switch.
 */
import { useState } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AlertTriangle } from "lucide-react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { BigActionCard } from "./BigActionCard";
import { ErrorState } from "./ErrorState";
import { Field } from "./Field";
import { Sheet } from "./Sheet";
import { StatusChip } from "./StatusChip";
import { ToastProvider, useToast } from "./Toast";

describe("StatusChip", () => {
  it("carries its own icon and text, so colour is never the only signal", () => {
    render(
      <StatusChip tone="warning" icon={AlertTriangle}>
        Under review
      </StatusChip>,
    );
    const chip = screen.getByText("Under review");
    expect(chip).toBeInTheDocument();
    const icon = chip.parentElement?.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });
});

describe("BigActionCard", () => {
  it("is one large target and a separate speak button, never a nested button", async () => {
    const onClick = vi.fn();
    const onSpeak = vi.fn();
    render(
      <BigActionCard
        icon={AlertTriangle}
        label="Unpaid wages"
        onClick={onClick}
        onSpeak={onSpeak}
        speakLabel="Read unpaid wages aloud"
      />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    // A button inside a button is invalid HTML and traps screen readers.
    expect(buttons[1].contains(buttons[0])).toBe(false);

    // Exact names: the speak label deliberately contains the card's label, so a
    // loose match would find both and prove nothing.
    await userEvent.click(screen.getByRole("button", { name: "Unpaid wages" }));
    await userEvent.click(screen.getByRole("button", { name: "Read unpaid wages aloud" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSpeak).toHaveBeenCalledTimes(1);
  });
});

describe("Field", () => {
  it("ties the error to the input so it is announced, not just coloured", () => {
    render(<Field label="Subject" error="This field is required" />);
    const input = screen.getByLabelText("Subject");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("This field is required");
    expect(screen.getByRole("alert")).toHaveTextContent("This field is required");
  });

  it("points at the hint instead when there is no error", () => {
    render(<Field label="Employer" hint="Optional" />);
    const input = screen.getByLabelText("Employer");
    expect(input).not.toHaveAttribute("aria-invalid");
    const hint = document.getElementById(input.getAttribute("aria-describedby")!);
    expect(hint).toHaveTextContent("Optional");
  });

  it("offers the microphone as an optional toggle, not a required control", async () => {
    const onMic = vi.fn();
    render(<Field label="Description" onMic={onMic} micLabel="Speak description" />);
    const mic = screen.getByRole("button", { name: "Speak description" });
    expect(mic).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(mic);
    expect(onMic).toHaveBeenCalled();
  });
});

describe("Sheet", () => {
  beforeEach(() => {
    document.body.style.overflow = "";
  });
  afterEach(() => {
    document.body.style.overflow = "";
  });

  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open filters
        </button>
        <Sheet open={open} onClose={() => setOpen(false)} title="Filters" closeLabel="Close">
          <button type="button">Inside</button>
        </Sheet>
      </>
    );
  }

  it("announces itself as a modal dialog and takes focus", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open filters" }));
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(dialog).toHaveFocus());
  });

  it("closes on Escape and gives focus back to whatever opened it", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open filters" });
    await userEvent.click(opener);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("stops the page behind it from scrolling while open", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open filters" }));
    expect(document.body.style.overflow).toBe("hidden");
  });
});

describe("Toast", () => {
  function Trigger() {
    const { show } = useToast();
    return (
      <>
        <button type="button" onClick={() => show("Wage entry saved")}>
          Save
        </button>
        <button type="button" onClick={() => show("Could not save", "error")}>
          Fail
        </button>
      </>
    );
  }

  it("announces politely rather than interrupting", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("Wage entry saved");
  });

  it("can be dismissed by hand", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Fail" }));
    await userEvent.click(screen.getByRole("button", { name: "a11y.dismiss" }));
    await waitFor(() => expect(screen.queryByText("Could not save")).not.toBeInTheDocument());
  });
});

describe("ErrorState", () => {
  it("states the reason and offers the way out", async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Could not load your wages" onRetry={onRetry} retryLabel="Retry" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load your wages");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });
});
