import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect } from 'vitest';

/**
 * Compares `value`, as JSON, with a golden file that changes only when the test runs with
 * UPDATE_GOLDEN=1, so that every change to it shows in the diff of a PR.
 */
export function expectGoldenJson(file: string, value: unknown): void {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    return;
  }
  expect(existsSync(file), `${file} is missing: run the test with UPDATE_GOLDEN=1 and read the file`).toBe(true);
  expect(text).toBe(readFileSync(file, 'utf8'));
}
