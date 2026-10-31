// Copies Preact (with its hooks) and htm from node_modules into app/vendor/preact/ and
// app/vendor/htm/. The app has no bundler, so the vendored ES modules are what browsers load;
// the hooks module's bare `from "preact"` is rewritten to the vendored file next to it.
// Run after changing the pinned versions in package.json: `pnpm --filter @rodokmen/app vendor`.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The directory and version of an installed package.
 * @param {string} name
 * @param {string} major the major version this script was written for
 */
async function pkg(name, major) {
  // htm's package exports do not include package.json, so the package is found by its folder.
  const dir = join(appDir, 'node_modules', name);
  /** @type {unknown} */
  const json = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const version = typeof json === 'object' && json !== null && 'version' in json && typeof json.version === 'string' ? json.version : '';
  if (!version.startsWith(`${major}.`)) throw new Error(`Expected ${name} ${major}.x, found ${version || 'no version'}`);
  return { dir, version };
}

const preact = await pkg('preact', '10');
const htm = await pkg('htm', '3');

const preactOut = join(appDir, 'vendor', 'preact');
await rm(preactOut, { recursive: true, force: true });
await mkdir(preactOut, { recursive: true });
await cp(join(preact.dir, 'dist', 'preact.module.js'), join(preactOut, 'preact.module.js'));
await cp(join(preact.dir, 'dist', 'preact.module.js.map'), join(preactOut, 'preact.module.js.map'));
const hooks = await readFile(join(preact.dir, 'hooks', 'dist', 'hooks.module.js'), 'utf8');
const imports = hooks.match(/from\s*["']preact["']/g) ?? [];
if (imports.length !== 1) throw new Error(`Expected one import of "preact" in hooks.module.js, found ${imports.length}`);
// Its source map is not vendored (the rewrite shifts the columns), so the link to it goes.
await writeFile(
  join(preactOut, 'hooks.module.js'),
  hooks.replace(/from\s*["']preact["']/, 'from"./preact.module.js"').replace(/\/\/# sourceMappingURL=.*$/m, ''),
);
await cp(join(preact.dir, 'LICENSE'), join(preactOut, 'LICENSE'));
// Types for the ES modules come from the packages themselves (dev dependencies).
await writeFile(join(preactOut, 'preact.module.d.ts'), '// Types for the vendored Preact ES module, taken from the preact package.\nexport * from "preact";\n');
await writeFile(
  join(preactOut, 'hooks.module.d.ts'),
  '// Types for the vendored Preact hooks, taken from the preact package.\nexport * from "preact/hooks";\n',
);
await writeFile(join(preactOut, 'VERSION'), `${preact.version}\n`);

const htmOut = join(appDir, 'vendor', 'htm');
await rm(htmOut, { recursive: true, force: true });
await mkdir(htmOut, { recursive: true });
await cp(join(htm.dir, 'dist', 'htm.module.js'), join(htmOut, 'htm.module.js'));
await cp(join(htm.dir, 'LICENSE'), join(htmOut, 'LICENSE'));
await writeFile(join(htmOut, 'htm.module.d.ts'), '// Types for the vendored htm ES module, taken from the htm package.\nexport { default } from "htm";\n');
await writeFile(join(htmOut, 'VERSION'), `${htm.version}\n`);

console.log(`Vendored Preact ${preact.version} into ${preactOut} and htm ${htm.version} into ${htmOut}`);
