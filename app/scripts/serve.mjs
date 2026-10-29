#!/usr/bin/env node
// Serves app/ locally: node scripts/serve.mjs [--port 4173] [--base /rodokmen-app/]
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { startServer } from './lib/static-server.mjs';

const { values } = parseArgs({ options: { port: { type: 'string', default: '4173' }, base: { type: 'string', default: '/' }, root: { type: 'string' } } });
const root = values.root ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await startServer({ root, port: Number(values.port), base: values.base });
console.log(`Serving ${root} at ${server.url}`);
