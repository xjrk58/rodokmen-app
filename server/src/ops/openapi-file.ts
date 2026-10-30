import { fileURLToPath } from 'node:url';
import { buildApp } from '../app.js';
import type { Config } from '../config.js';
import { createDb } from '../db/db.js';
import { OutboxMailer } from '../mail/mailer.js';
import { checkRouteCoverage, openApiDocument } from '../openapi.js';

/** The published OpenAPI description, committed at server/openapi.json. */
export const OPENAPI_FILE = fileURLToPath(new URL('../../openapi.json', import.meta.url));

/**
 * Builds the app without touching the database (no query runs) and returns its OpenAPI
 * description plus the route comparison's problems.
 */
export async function openApiJson(config: Config): Promise<{ json: string; problems: string[] }> {
  const db = createDb(config.databaseUrl);
  try {
    const app = await buildApp({ config: { ...config, appDir: '/nonexistent' }, db, mailer: new OutboxMailer() });
    const doc = openApiDocument(app);
    const problems = checkRouteCoverage(app.routeRecords, doc);
    await app.close();
    return { json: `${JSON.stringify(doc, null, 2)}\n`, problems };
  } finally {
    await db.destroy();
  }
}
