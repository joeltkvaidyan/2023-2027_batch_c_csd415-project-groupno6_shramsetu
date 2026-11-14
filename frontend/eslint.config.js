import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import prettier from "eslint-config-prettier";

/**
 * Frontend lint gate.
 *
 * The rules that matter for this app are the two hooks rules (a stale closure
 * in the chat page means a worker's question is answered against the wrong
 * conversation) and jsx-a11y (the target user is on a low-end phone with a
 * screen reader, not a mouse). Everything else is the TypeScript recommended
 * set, which catches the "as any" escapes that hide broken API shapes.
 *
 * Formatting is Prettier's job — eslint-config-prettier is last so the two
 * never disagree.
 */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "public/**",
      "*.config.js",
      "https-proxy.cjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "error",
      // eslint-plugin-react-hooks v7 ships the React Compiler rules. They are
      // aimed at code that already separates render from effects; this app
      // loads data in effects on purpose (there is no router loader and the
      // offline-first pages must work before hydration settles). Turning them
      // on now would paint 14 sites red without changing behaviour, so they
      // are off until the Phase-2 component rebuild moves those loads behind
      // route loaders.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/refs": "off",
      "react-hooks/static-components": "off",
      ...jsxA11y.flatConfigs.recommended.rules,
      // `<RoleRoute role="worker">` passes a routing role to our own component,
      // not an ARIA role to a DOM element. Without this the rule reads the prop
      // name and flags every guarded route; `div role="..."` is still checked.
      "jsx-a11y/aria-role": ["error", { ignoreNonDOM: true }],
      // Unused args are fine when they document a signature; unused vars are not.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // `any` is the escape hatch that let three broken API shapes ship. Warn
      // instead of error so a genuine interop cast can still be explained in a
      // comment, but every one shows up in review.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["src/**/*.test.{ts,tsx}", "src/test/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  prettier,
);
