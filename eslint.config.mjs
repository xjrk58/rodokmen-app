// Lint rules for the whole workspace (`pnpm lint`). They target real problems: promises nobody
// awaits, `any` and unchecked casts leaking through, loose equality, files that keep growing.
// Layout is Prettier's job (`pnpm format:check`); eslint-config-prettier turns off the overlap.
//
// Existing violations are recorded per file and rule in eslint-suppressions.json. A new
// violation fails, and so does a suppression that no longer occurs: after fixing code, run
// `pnpm exec eslint --prune-suppressions .` so the file only ever shrinks.
//
// Type-aware rules need a TypeScript program. server/ and shared/ compile with TypeScript 7,
// which has no JavaScript API yet, so linting uses the TypeScript 6 at the workspace root.
// app/ is plain JavaScript checked through JSDoc; its three tsconfigs supply the types.
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const root = import.meta.dirname;
const unusedVars = { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true };

/** For every file with type information: TypeScript, and app/ JavaScript with JSDoc types. */
const typedRules = {
  // node:test's test() and describe() return promises that the runner awaits itself.
  '@typescript-eslint/no-floating-promises': [
    'error',
    { allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['test', 'it', 'describe', 'suite'] }] },
  ],
  '@typescript-eslint/no-misused-promises': 'error',
  // Fastify plugins and test doubles are async by contract, whether or not they await.
  '@typescript-eslint/require-await': 'off',
  '@typescript-eslint/return-await': ['error', 'error-handling-correctness-only'],
  '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
  '@typescript-eslint/no-deprecated': 'error',
  '@typescript-eslint/no-unused-vars': ['error', unusedVars],
};

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/.cache/**',
      'app/vendor/**',
      'app/data/**',
      '.claude/**',
      'openspec/**',
    ],
  },

  js.configs.recommended,
  comments.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-unused-vars': ['error', unusedVars],
      // A rule may be turned off for a line only with the reason written next to it.
      '@eslint-community/eslint-comments/require-description': ['error', { ignore: ['eslint-enable'] }],
      '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      complexity: ['error', 20],
      'max-depth': ['error', 4],
    },
  },

  // ---------------------------------------------------------------- server/ and shared/ (TypeScript)
  {
    files: ['server/**/*.ts', 'shared/**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: { project: ['server/tsconfig.json', 'shared/tsconfig.json'], tsconfigRootDir: root },
    },
    rules: {
      ...typedRules,
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      // `x as T` that narrows without a check: validate with Zod or a type guard instead.
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
    },
  },

  // ---------------------------------------------------------------- app/ (JavaScript with JSDoc types)
  {
    files: ['app/app.js', 'app/src/**/*.js', 'app/sw.js', 'app/scripts/**/*.mjs', 'app/tests/**/*.{js,mjs}', 'app/playwright.config.js'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { project: ['app/tsconfig.json', 'app/tsconfig.sw.json', 'app/tsconfig.node.json'], tsconfigRootDir: root },
    },
    rules: {
      ...typedRules,
      // JSDoc casts (`/** @type {X} */ (y)`) are how plain JavaScript narrows a type.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
  { files: ['app/app.js', 'app/src/**/*.js'], languageOptions: { globals: globals.browser } },
  { files: ['app/sw.js'], languageOptions: { globals: globals.serviceworker } },
  // Node scripts and tests; Playwright's page.evaluate callbacks run in the browser.
  {
    files: ['app/scripts/**/*.mjs', 'app/tests/**/*.{js,mjs}', 'app/playwright.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  // ---------------------------------------------------------------- JavaScript without type information
  // The sign-in pages, served as they are.
  { files: ['server/public/**/*.js'], languageOptions: { globals: globals.browser, sourceType: 'module' } },
  // Workspace tooling: this file and scripts/.
  { files: ['*.mjs', 'scripts/**/*.mjs'], languageOptions: { globals: globals.node } },

  prettier,
);
