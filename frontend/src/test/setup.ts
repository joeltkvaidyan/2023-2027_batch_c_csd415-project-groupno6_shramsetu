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
 * Note on crypto: jsdom in this Vitest environment does provide crypto.subtle,
 * so documentSecurity exercises its real PBKDF2 path with no polyfill here. If
 * a future environment ever dropped it, the module would silently fall back to
 * its legacy hash — and `documentSecurity.test.ts` asserts the stored format
 * starts with "pbkdf2:", so that regression fails loudly instead of quietly
 * testing weaker code.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(cleanup);
