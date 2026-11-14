import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect } from 'vitest';

/**
 * Compares `text` with a golden file, which changes only when the test runs with UPDATE_GOLDEN=1,
 * so that every change to it shows in the diff of a PR (kinship design, "Determinism and the tools
 * that keep it").
 */
export function expectGolden(file: string, text: string): void {
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    return;
  }
  expect(existsSync(file), `${file} is missing: run the test with UPDATE_GOLDEN=1 and read the file`).toBe(true);
  expect(text).toBe(readFileSync(file, 'utf8'));
}
