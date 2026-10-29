// Copies Leaflet's distribution files from node_modules into app/vendor/leaflet/.
// The app has no bundler, so the vendored copy is what browsers load. Run after
// changing the pinned Leaflet version in package.json: `pnpm --filter @rodokmen/app vendor`.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('leaflet/package.json'));
const { version } = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'));
if (!version.startsWith('1.9.')) throw new Error(`Expected Leaflet 1.9.x, found ${version}`);

const out = join(appDir, 'vendor', 'leaflet');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const file of ['leaflet-src.esm.js', 'leaflet-src.esm.js.map', 'leaflet.css']) {
  await cp(join(pkgDir, 'dist', file), join(out, file));
}
await cp(join(pkgDir, 'dist', 'images'), join(out, 'images'), { recursive: true });
await cp(join(pkgDir, 'LICENSE'), join(out, 'LICENSE'));
// Types for the ES module come from @types/leaflet.
await writeFile(join(out, 'leaflet-src.esm.d.ts'), '// Types for the vendored Leaflet ES module, taken from @types/leaflet.\nexport * from "leaflet";\n');
await writeFile(join(out, 'VERSION'), `${version}\n`);
console.log(`Vendored Leaflet ${version} into ${out}`);
