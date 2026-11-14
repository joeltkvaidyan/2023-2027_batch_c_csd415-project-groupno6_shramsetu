/**
 * RoleRoute is the only thing standing between a URL and a page, so its
 * branches are security-relevant. Four states, four different outcomes:
 *
 *   checking → skeleton (no page content). The verdict is unknown, so nothing
 *              protected may render — not even a cached header.
 *   denied   → the login page for THAT role, not a generic one.
 *   error    → retry. A network failure is not a logout.
 *   allowed  → the page.
 *
 * `useAuth` and `resolveRole` are mocked rather than driven through a real
 * provider: this is a test of the branch logic, and fakes keep each state
 * explicit and independent of axios timing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const useAuth = vi.fn();
const refreshMe = vi.fn();
const resolveRole = vi.fn();

vi.mock("../store/AuthContext", () => ({ useAuth: () => useAuth() }));

// The guard also learns about a session that dies while the page is open, so
// the fake session module records its listeners and the test fires them.
const expiryListeners: Array<() => void> = [];
vi.mock("../api/session", () => ({
  resolveRole: (...args: unknown[]) => resolveRole(...args),
  onSessionExpired: (listener: () => void) => {
    expiryListeners.push(listener);
    return () => {};
  },
}));
// Echo the key so assertions do not depend on which locale is loaded.
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { RoleRoute } from "./RoleRoute";

function setWorkerAuth(state: Partial<ReturnType<typeof useAuth>>) {
  useAuth.mockReturnValue({ worker: null, loading: false, bootError: false, refreshMe, ...state });
}

function renderAt(path: string, role: "worker" | "employer" | "citizen" | "government") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path={path}
          element={
            <RoleRoute role={role}>
              <div>secret dashboard</div>
            </RoleRoute>
          }
        />
        <Route path="/worker/login" element={<div>worker login</div>} />
        <Route path="/employer/login" element={<div>employer login</div>} />
        <Route path="/citizen/login" element={<div>citizen login</div>} />
        <Route path="/government/login" element={<div>government login</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  expiryListeners.length = 0;
  setWorkerAuth({});
});

describe("RoleRoute — worker", () => {
  it("shows a skeleton, not the page, while the session is being checked", () => {
    setWorkerAuth({ loading: true });
    renderAt("/worker/dashboard", "worker");

    expect(screen.getByTestId("route-skeleton")).toBeTruthy();
    expect(screen.queryByText("secret dashboard")).toBeNull();
  });

  it("renders the page for a signed-in worker", () => {
    setWorkerAuth({ worker: { worker_id: "W-1" } });
    renderAt("/worker/dashboard", "worker");
    expect(screen.getByText("secret dashboard")).toBeTruthy();
  });

  it("sends an anonymous visitor to the worker login", () => {
    renderAt("/worker/dashboard", "worker");
    expect(screen.getByText("worker login")).toBeTruthy();
    expect(screen.queryByText("secret dashboard")).toBeNull();
  });

  it("offers a retry instead of logging out when the boot check failed", async () => {
    setWorkerAuth({ bootError: true });
    renderAt("/worker/dashboard", "worker");

    expect(screen.queryByText("worker login")).toBeNull();
    await userEvent.click(screen.getByText("common.retry"));
    expect(refreshMe).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale boot error once a worker is present", () => {
    setWorkerAuth({ bootError: true, worker: { worker_id: "W-1" } });
    renderAt("/worker/dashboard", "worker");
    expect(screen.getByText("secret dashboard")).toBeTruthy();
  });
});

describe("RoleRoute — other roles", () => {
  it("asks the server for the role and renders nothing until it answers", async () => {
    let answer: (role: string) => void = () => {};
    resolveRole.mockReturnValue(new Promise((resolve) => (answer = resolve)));

    renderAt("/government/dashboard", "government");
    expect(screen.getByTestId("route-skeleton")).toBeTruthy();
    expect(screen.queryByText("secret dashboard")).toBeNull();

    answer("government");
    expect(await screen.findByText("secret dashboard")).toBeTruthy();
  });

  it("bounces a session of another role to that role's own login", async () => {
    // A worker opening a government URL must not be shown a government form,
    // and must not be left on a blank page either.
    resolveRole.mockResolvedValue("worker");
    renderAt("/government/dashboard", "government");

    expect(await screen.findByText("government login")).toBeTruthy();
    expect(screen.queryByText("secret dashboard")).toBeNull();
  });

  it("redirects when there is no session at all", async () => {
    resolveRole.mockResolvedValue(null);
    renderAt("/employer/dashboard", "employer");
    expect(await screen.findByText("employer login")).toBeTruthy();
  });

  it("renders a citizen dashboard only for a citizen session", async () => {
    resolveRole.mockResolvedValue("citizen");
    renderAt("/citizen/dashboard", "citizen");
    expect(await screen.findByText("secret dashboard")).toBeTruthy();
  });

  it("shows a retry — not a login redirect — when the check itself fails", async () => {
    resolveRole.mockRejectedValueOnce(new Error("offline"));
    renderAt("/government/dashboard", "government");

    expect(await screen.findByText("common.error")).toBeTruthy();
    expect(screen.queryByText("government login")).toBeNull();

    resolveRole.mockResolvedValueOnce("government");
    await userEvent.click(screen.getByText("common.retry"));
    expect(await screen.findByText("secret dashboard")).toBeTruthy();
    // The retry must bypass the cached answer that produced the error.
    expect(resolveRole).toHaveBeenLastCalledWith(true);
  });

  it("drops the page when the session expires while it is open", async () => {
    resolveRole.mockResolvedValue("government");
    renderAt("/government/dashboard", "government");
    expect(await screen.findByText("secret dashboard")).toBeTruthy();

    act(() => {
      for (const listener of expiryListeners) listener();
    });

    expect(await screen.findByText("government login")).toBeTruthy();
    expect(screen.queryByText("secret dashboard")).toBeNull();
  });

  it("leaves a page that resolves to the wrong role permanently blocked", async () => {
    resolveRole.mockResolvedValue("citizen");
    renderAt("/government/dashboard", "government");

    expect(await screen.findByText("government login")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("secret dashboard")).toBeNull());
  });
});
