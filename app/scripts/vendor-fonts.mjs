// Copies the fonts of the Charts from Fontsource's npm packages into app/vendor/fonts/<package>/:
// the WOFF2 files of the latin and latin-ext subsets of each face in scripts/lib/chart-fonts.mjs,
// under Fontsource's file names, with the package's LICENSE (the SIL Open Font License and the
// font's copyright line) and a VERSION file. app/styles.css declares the faces. Run after changing
// the pinned versions in package.json: `pnpm --filter @rodokmen/app vendor`, then
// `pnpm --filter @rodokmen/app font-metrics` for the widths in app/data/chart-fonts.json.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACES, fontFile, SUBSETS } from './lib/chart-fonts.mjs';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(appDir, 'vendor', 'fonts');
const faces = Object.values(FACES);

await rm(out, { recursive: true, force: true });
for (const name of [...new Set(faces.map((f) => f.package))]) {
  // The packages are found by folder: their exports map only CSS and font files.
  const dir = join(appDir, 'node_modules', '@fontsource', name);
  /** @type {unknown} */
  const json = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const version = typeof json === 'object' && json !== null && 'version' in json && typeof json.version === 'string' ? json.version : '';
  if (!version.startsWith('5.')) throw new Error(`Expected @fontsource/${name} 5.x, found ${version || 'no version'}`);
  const dest = join(out, name);
  await mkdir(dest, { recursive: true });
  for (const face of faces.filter((f) => f.package === name)) {
    for (const subset of SUBSETS) {
      const file = basename(fontFile(face, subset));
      await cp(join(dir, 'files', file), join(dest, file));
    }
  }
  await cp(join(dir, 'LICENSE'), join(dest, 'LICENSE'));
  await writeFile(join(dest, 'VERSION'), `${version}\n`);
  console.log(`Vendored @fontsource/${name} ${version} into ${dest}`);
}
