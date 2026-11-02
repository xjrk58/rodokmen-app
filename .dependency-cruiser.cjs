// dependency-cruiser (`pnpm depcruise`, part of `pnpm check`): which parts of the repo may import
// which. Each rule's comment says what it keeps apart and why; a violation names the rule.
// (The MCP server's boundary, no server code and no database, is ESLint's no-restricted-imports.)
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'app-not-server',
      comment: 'The app runs in the browser and talks to the server over the API only (ADR 0007); share types through shared/.',
      severity: 'error',
      from: { path: '^app/' },
      to: { path: '^server/' },
    },
    {
      name: 'support-not-tree',
      comment:
        'Sign-in, storage and operations do not depend on the Tree read modules (#21, M5: Clock sat in a Tree module that auth, storage and ops imported). Put what they share in its own module, as src/clock.ts.',
      severity: 'error',
      from: { path: '^server/src/(auth|storage|ops)/' },
      to: { path: '^server/src/tree/' },
    },
    {
      name: 'shared-stands-alone',
      comment: 'shared/ is the data model both sides build on; it never imports the app or the server.',
      severity: 'error',
      from: { path: '^shared/' },
      to: { path: '^(app|server)/' },
    },
    {
      name: 'no-circular',
      comment: 'A module may not import itself through others: break the cycle by moving the shared part into a module of its own.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'An import that cannot be resolved cannot be checked against the rules above: fix the path, or the resolve options below.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-orphans',
      comment: 'A module nothing imports is dead or an entry point; remove it, or list it here if it is run directly.',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          // Run directly: tools, scripts, tests and the apps' entry points.
          '(^|/)[^/]+\\.config\\.(js|mjs|cjs|ts)$',
          '^\\.dependency-cruiser\\.cjs$',
          '^eslint\\.config\\.mjs$',
          '^scripts/',
          '^app/(app|sw)\\.js$',
          '^app/scripts/',
          '^app/tests/',
          '^server/(mcp/)?test/',
          '^shared/test/',
          '\\.d\\.ts$',
          // JSDoc typedefs: the app's modules import them in `@typedef {import('./types.js')…}`, which is not an import.
          '^app/src/types\\.js$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Vendored libraries are not ours to check; build output and tool working files are not code.
    exclude: { path: ['^app/vendor/', '(^|/)(dist|coverage|test-results|playwright-report|\\.lemmascript)/'] },
    tsPreCompilationDeps: true,
    // server/ and shared/ import TypeScript as .js (NodeNext); the workspace packages resolve to
    // their source through the @rodokmen/source condition, as tsx and vitest resolve them.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['@rodokmen/source', 'import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js', '.mjs', '.cjs', '.d.ts', '.json'],
      mainFields: ['module', 'main', 'types'],
    },
    skipAnalysisNotInRules: true,
    // Known violations (.dependency-cruiser-known-violations.json) only shrink: one that no longer
    // occurs fails until `pnpm depcruise:baseline` removes it, and a new one is never added.
    baseline: { mode: 'shrink-only', staleEntriesSeverity: 'error' },
  },
};
