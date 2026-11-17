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
import playwright from 'eslint-plugin-playwright';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const root = import.meta.dirname;
const unusedVars = { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true };

// Code shapes that caused real bugs (#21). Each message names the bug and the safe way instead;
// scripts/test/quality-checks.test.mjs proves each one still fires on the original code.
// `no-restricted-syntax` takes one list per file, so a block for some files repeats the wider ones.
const restricted = {
  zodUrl: {
    // A Source link accepted `javascript:` and `data:` (#21, P2).
    selector: "CallExpression[callee.object.name='z'][callee.property.name='url']:not(:has(Property[key.name='protocol']))",
    message: 'z.url() accepts any scheme, javascript: and data: too. Use WebUrl (shared/src/schemas/common.ts) or z.url({ protocol: /^https?$/ }).',
  },
  rawRequestUrl: {
    // Sign-in was decided by `request.url`, so `/%61pi/…` reached /api without a session (#21, H1).
    selector:
      "MemberExpression[property.name=/^(url|originalUrl)$/][object.name=/^(request|req|raw)$/], MemberExpression[property.name='url'][object.property.name='raw']",
    message: 'Decide sign-in by the route the router matched (request.routeOptions.url and .config), never the raw URL: encoded paths walk around it.',
  },
  utcDay: {
    // A Citation's `readOn` was the UTC day, which is yesterday in Czechia until 1 or 2 a.m. (#21, P2).
    selector: "CallExpression[callee.property.name=/^(slice|substring|substr|split)$/][callee.object.callee.property.name='toISOString']",
    message: "toISOString() gives the UTC day, not the Member's: use today() from src/proposal-build.js, or getFullYear/getMonth/getDate.",
  },
  leafletHtml: {
    // Leaflet puts string content of tooltips and popups in as HTML; text from the Tree must go in as a node.
    selector:
      'CallExpression[callee.property.name=/^(bindTooltip|bindPopup|setTooltipContent|setPopupContent|setContent)$/][arguments.0.type=/^(TemplateLiteral|Literal|BinaryExpression)$/]',
    message: 'Leaflet treats a string as HTML: pass an element with text (h() from src/dom.js) instead.',
  },
};

// A Chart is the same for the same Tree, options, language and day, byte for byte (tree-charts
// spec, "Charts follow fixed rules"), and kinship gives the same answer every time, on every device
// and locale (kinship spec, "Kinship follows fixed rules"). Their modules may not read the clock,
// roll dice, or ask the device's locale data or layout engine, whose answers differ between devices
// and browsers.
const kinshipFiles = ['shared/src/kinship*.ts', 'shared/src/kinship-terms/**/*.ts'];
const chartFiles = [
  'shared/src/charts.ts',
  'shared/src/chart-kinship.ts',
  'shared/src/chart-rows.ts',
  'shared/src/charts-model.ts',
  'shared/src/house-chart.ts',
  'shared/src/house-chart-model.ts',
  'shared/src/sheet-reduction.ts',
  'server/src/charts/**/*.ts',
];
const chartAppFiles = ['app/src/chart-*.js'];
const determinism = [
  [
    "MemberExpression[object.name='Math'][property.name='random']",
    'Math.random() differs on every run: a Chart orders by dates, the recorded order and ids, and kinship takes every order from the ids.',
  ],
  [
    "MemberExpression[object.name='Date'][property.name='now']",
    'Date.now() reads the clock: a Chart gets its day as livingOn, from server/src/clock.ts, and the server stamps kinship with the state of the Tree.',
  ],
  [
    "NewExpression[callee.name='Date']",
    'new Date() reads the clock or parses by the device: a Chart gets its day as livingOn, and dates from the proved EDTF ranges; the clock never decides kinship.',
  ],
  [
    "MemberExpression[object.name='performance'][property.name='now']",
    'performance.now() reads the clock: a Chart may not depend on time, and kinship counts units of work, not time.',
  ],
  ["MemberExpression[property.name='randomUUID']", 'crypto.randomUUID() differs on every run: derive ids from record ids.'],
  [
    "MemberExpression[property.name='localeCompare']",
    'localeCompare depends on the ICU data of the device: compare ids by code units (a < b) and never order by names.',
  ],
  [
    'MemberExpression[property.name=/^toLocale/]',
    'toLocale*String depends on the device: write dates and numbers by the fixed patterns of the chart.* texts, and kinship terms from the tables in kinship-terms/.',
  ],
  [
    "MemberExpression[object.name='Intl'][property.name=/^(DateTimeFormat|Collator|NumberFormat|PluralRules)$/]",
    'Intl output changes between ICU versions: use the fixed patterns and plural rules of src/chart-text.js, and the kinship terms of kinship-terms/.',
  ],
  [
    'MemberExpression[property.name=/^(getBBox|getComputedTextLength)$/]',
    'Measuring text in the browser differs between devices: fit text by app/data/chart-fonts.json (src/chart-cards.js).',
  ],
].map(([selector, message]) => ({ selector, message }));

// Words GLOSSARY.md rejects that have no other meaning in this code, as exact identifiers
// (`town` for a Place, #21 L23). Words with other meanings (record, tag, root, account) stay allowed.
const glossaryRejects = [
  ...['town', 'towns', 'Town', 'village', 'villages', 'Village', 'obec', 'farnost', 'manor', 'dominion', 'herrschaft', 'commune'],
  ...['moderator', 'superuser', 'proband'],
];

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
      '**/.lemmascript/**',
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
      'id-denylist': ['error', ...glossaryRejects],
    },
  },

  // ---------------------------------------------------------------- server/ and shared/ (TypeScript)
  {
    files: ['server/**/*.ts', 'shared/**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: { project: ['server/tsconfig.json', 'server/mcp/tsconfig.json', 'shared/tsconfig.json'], tsconfigRootDir: root },
    },
    rules: {
      ...typedRules,
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      // `x as T` that narrows without a check: validate with Zod or a type guard instead.
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      'no-restricted-syntax': ['error', restricted.zodUrl],
    },
  },
  // The sign-in hooks.
  { files: ['server/src/auth/**/*.ts'], rules: { 'no-restricted-syntax': ['error', restricted.zodUrl, restricted.rawRequestUrl] } },
  // The Chart's rules and its server shell, and the kinship modules.
  { files: [...chartFiles, ...kinshipFiles], rules: { 'no-restricted-syntax': ['error', restricted.zodUrl, ...determinism] } },

  // The MCP server is a client of the public API (add-agent-access design): it may not reach the
  // database or the server's code, so it can offer nothing the Agent token may not do there.
  {
    files: ['server/mcp/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['../../src/*', '../../src/**', '**/server/src/**'], message: 'server/mcp calls the API over HTTP; it does not use the server code.' },
            { group: ['kysely', 'kysely/*', 'pg', 'pg-*'], message: 'server/mcp has no database access; call the API.' },
          ],
        },
      ],
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
  {
    files: ['app/app.js', 'app/src/**/*.js'],
    languageOptions: { globals: globals.browser },
    rules: { 'no-restricted-syntax': ['error', restricted.leafletHtml, restricted.utcDay] },
  },
  // The Chart's layout and drawing.
  { files: chartAppFiles, rules: { 'no-restricted-syntax': ['error', restricted.leafletHtml, restricted.utcDay, ...determinism] } },
  { files: ['app/sw.js'], languageOptions: { globals: globals.serviceworker } },
  // Node scripts and tests; Playwright's page.evaluate callbacks run in the browser.
  {
    files: ['app/scripts/**/*.mjs', 'app/tests/**/*.{js,mjs}', 'app/playwright.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  // ---------------------------------------------------------------- browser tests (Playwright)
  // A fixed wait passes or fails by timing, not by the page (#21, L18); an assertion that cannot
  // fail proves nothing. The app's tests use @playwright/test.
  {
    files: ['app/tests/e2e/**/*.js'],
    extends: [playwright.configs['flat/recommended']],
    rules: {
      'playwright/no-wait-for-timeout': 'error',
      // `test.skip(condition, reason)` runs a test only where it can run (touch on the phone, CDP in Chromium).
      'playwright/no-skipped-test': ['warn', { allowConditional: true }],
    },
  },
  // The server's browser tests drive Playwright from vitest, so only the rules on the page API
  // apply; vitest's describe, it and expect are not Playwright's.
  {
    files: ['server/test/**/*.e2e.test.ts'],
    plugins: { playwright },
    rules: {
      'playwright/no-wait-for-timeout': 'error',
      'playwright/no-wait-for-selector': 'error',
      'playwright/no-wait-for-navigation': 'error',
      'playwright/no-networkidle': 'error',
      'playwright/no-element-handle': 'error',
      'playwright/no-eval': 'error',
      'playwright/no-force-option': 'error',
      'playwright/no-page-pause': 'error',
      'playwright/no-unused-locators': 'error',
      'playwright/no-useless-await': 'error',
    },
  },

  // ---------------------------------------------------------------- JavaScript without type information
  // Workspace tooling: this file and scripts/.
  { files: ['*.mjs', 'scripts/**/*.mjs'], languageOptions: { globals: globals.node } },

  prettier,
);
