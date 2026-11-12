import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** What the server uses of app/scripts/stamp-version.mjs. */
interface StampScript {
  UNSTAMPED: string;
  STAMPED_FILES: string[];
  computeVersion(dir: string): Promise<string>;
  stampIn(file: string, text: string): string | null;
  stampText(file: string, text: string, version: string): string;
}

function isStampScript(m: unknown): m is StampScript {
  return (
    typeof m === 'object' &&
    m !== null &&
    'UNSTAMPED' in m &&
    typeof m.UNSTAMPED === 'string' &&
    'STAMPED_FILES' in m &&
    Array.isArray(m.STAMPED_FILES) &&
    'computeVersion' in m &&
    typeof m.computeVersion === 'function' &&
    'stampIn' in m &&
    typeof m.stampIn === 'function' &&
    'stampText' in m &&
    typeof m.stampText === 'function'
  );
}

/** The files of a checkout's app that carry the version stamp, stamped as they are sent. */
export interface CheckoutStamp {
  /** The files, as paths below the app with "/": sw.js and src/version.js. */
  files: string[];
  /** The file's text, stamped with the release version of the app's files as they are now. */
  stamped(file: string): Promise<string>;
}

/**
 * The app's version stamp (#91). A built site, such as the image's /srv/app, was stamped when it
 * was built (app/scripts/site-files.mjs --copy), and its files go out as they are: null here. A
 * checkout's app/ carries a placeholder instead, so that branches do not conflict on the stamp.
 * When the server serves a checkout (`dev`, the tests), it stamps the two files as it sends them,
 * with the checkout's own app/scripts/stamp-version.mjs, from the files as they are then: a
 * changed app file gives the service worker a new version here too, as it would in production.
 */
export async function checkoutStamp(appDir: string): Promise<CheckoutStamp | null> {
  const script = join(appDir, 'scripts', 'stamp-version.mjs');
  if (!existsSync(script)) return null;
  const mod: unknown = await import(pathToFileURL(script).href);
  if (!isStampScript(mod)) throw new Error(`${script} does not offer what the server needs to stamp the app`);
  const text = (file: string) => readFile(join(appDir, file), 'utf8');
  // Stamped already, though it has the scripts: serve it as it is.
  if (mod.stampIn('sw.js', await text('sw.js')) !== mod.UNSTAMPED) return null;
  return {
    files: mod.STAMPED_FILES,
    stamped: async (file) => mod.stampText(file, await text(file), await mod.computeVersion(appDir)),
  };
}
