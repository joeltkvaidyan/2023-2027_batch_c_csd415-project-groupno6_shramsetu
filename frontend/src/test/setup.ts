/**
 * Shared test setup.
 *
 * 1. jest-dom matchers, so assertions read as `toBeInTheDocument()` rather than
 *    a pile of `getAttribute` calls.
 * 2. Explicit unmounting between tests. Testing Library only auto-registers
 *    this when it can see a global `afterEach`, which it cannot here — we avoid
 *    `globals: true` so the test files typecheck under the repo's existing
 *    tsconfig without a "vitest/globals" types entry. Without the cleanup every
 *    render from test 1 is still mounted during test 2, and getByText throws
 *    "found multiple elements" instead of the failure the test meant.
 *
 * Note on crypto: the document-wallet PIN no longer hashes in the browser. It
 * is verified server-side with scrypt and returns a short-lived wallet token,
 * so `documentSecurity.test.ts` mocks the API client and asserts token and
 * idle-timeout behaviour rather than any local digest format.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(cleanup);
