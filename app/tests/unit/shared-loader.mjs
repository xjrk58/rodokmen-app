// Lets unit tests import shared/src (TypeScript) directly, so the app's code is
// checked against the very schemas the server uses. shared/src imports its
// siblings as "./x.js" (the compiled names) and uses TypeScript syntax that
// Node's type stripping alone does not accept (parameter properties), so this
// hook resolves "./x.js" to "./x.ts" and transforms .ts files on load.
// Import this module before importing anything from shared/src.
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && specifier.endsWith('.js')) return next(`${specifier.slice(0, -3)}.ts`, context);
      throw error;
    }
  },
  load(url, context, next) {
    if (!url.startsWith('file:') || !url.endsWith('.ts')) return next(url, context);
    const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform', sourceUrl: url });
    return { format: 'module', source, shortCircuit: true };
  },
});
