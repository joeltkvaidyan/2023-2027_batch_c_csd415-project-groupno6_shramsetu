/**
 * The offline strip is the only place the app admits that a queued complaint has
 * not actually reached the labour office. So the tests are about restraint as
 * much as content: nothing at all when online with an empty queue, the queue
 * count (not a vague "syncing") when writes are waiting, and a trigger to replay
 * the moment the connection comes back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

const isOnline = vi.fn();
const getPendingSyncItems = vi.fn();
const processSyncQueue = vi.fn();
let listeners: Array<(online: boolean) => void> = [];

vi.mock("../services/offlineStorage", () => ({
  isOnline: () => isOnline(),
  getPendingSyncItems: () => getPendingSyncItems(),
  processSyncQueue: () => processSyncQueue(),
  onOnlineStatusChange: (cb: (online: boolean) => void) => {
    listeners.push(cb);
    return () => {
      listeners = listeners.filter((l) => l !== cb);
    };
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts?.count === undefined ? key : `${key}:${opts.count}`,
  }),
}));

import { OfflineBanner } from "./OfflineBanner";

describe("OfflineBanner", () => {
  beforeEach(() => {
    listeners = [];
    isOnline.mockReturnValue(true);
    getPendingSyncItems.mockResolvedValue([]);
    processSyncQueue.mockResolvedValue(null);
  });

  it("renders nothing when there is a connection and nothing waiting", async () => {
    const { container } = render(<OfflineBanner />);
    await waitFor(() => expect(getPendingSyncItems).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("says it is offline instead of leaving the worker guessing", async () => {
    isOnline.mockReturnValue(false);
    render(<OfflineBanner />);
    expect(await screen.findByRole("status")).toHaveTextContent("offline.offline");
  });

  it("counts a single waiting entry in the singular", async () => {
    getPendingSyncItems.mockResolvedValue([{ id: "a" }]);
    render(<OfflineBanner />);
    expect(await screen.findByRole("status")).toHaveTextContent("offline.pendingOne");
  });

  it("counts several waiting entries", async () => {
    getPendingSyncItems.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    render(<OfflineBanner />);
    expect(await screen.findByRole("status")).toHaveTextContent("offline.pendingMany:2");
  });

  it("replays the queue as soon as the connection returns", async () => {
    isOnline.mockReturnValue(false);
    render(<OfflineBanner />);
    await screen.findByRole("status");

    await act(async () => {
      listeners.forEach((cb) => cb(true));
    });

    await waitFor(() => expect(processSyncQueue).toHaveBeenCalled());
  });

  it("does not claim a queue when IndexedDB cannot be read", async () => {
    // Private browsing: the queue is unreadable, so the count is unknown rather
    // than crashing the strip (which would take the whole app down with it).
    getPendingSyncItems.mockRejectedValue(new Error("no IndexedDB"));
    const { container } = render(<OfflineBanner />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
