// Golden files for the Chart models: compared byte for byte, rewritten only with UPDATE_GOLDEN=1,
// so that a change shows up in the PR's diff.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'charts');

/** Compares the model with its golden file, or writes the file with UPDATE_GOLDEN=1. */
export function golden(name: string, value: unknown): void {
  const file = join(GOLDEN, `${name}.json`);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(file, text);
    return;
  }
  expect(existsSync(file), `${file} is missing: run with UPDATE_GOLDEN=1`).toBe(true);
  expect(text).toBe(readFileSync(file, 'utf8'));
}
