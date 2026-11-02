import { ReadingResult } from '@rodokmen/shared';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadSamples, runBenchmark } from '../scripts/scan-benchmark/run.js';
import { characterErrorRate, editDistance, SampleTruth, scorePage, summarise, summaryTable } from '../scripts/scan-benchmark/score.js';
import { fakeAnthropic, fakeReader, recording } from './fake-anthropic.js';

const SAMPLES = new URL('../scripts/scan-benchmark/samples', import.meta.url).pathname;

/**
 * The scan reading benchmark (add-scan-reading task 1.2): its scoring, and a whole run on the
 * example sample with the reader on a recorded answer and a Transkribus export, without the
 * network. The real run needs the Owner's API key and Transkribus account.
 */
describe('scan reading benchmark', () => {
  const truth = SampleTruth.parse({
    source: 'invented',
    script: 'latin',
    languages: ['la'],
    transcription: 'Die 14. Martii baptizata est Anna, filia Joannis Nowak coloni N. 15',
    entries: [{ date: '1830-03-14', house: '15', names: ['Anna', 'Joannis Nowak'] }],
  });
  const result = ReadingResult.parse(JSON.parse(recording('faded-house').content[0]!.text!));

  it('measures the character error rate as edit distance over the true length, after whitespace only', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(characterErrorRate('Anna  filia', 'Anna filia')).toBe(0);
    expect(characterErrorRate('Nowak', 'Novak')).toBeCloseTo(1 / 5);
    expect(characterErrorRate('Nowak', '')).toBe(1);
  });

  it('scores a structured reading: names folded, dates and house numbers exactly', () => {
    const score = scorePage(
      { ...truth, entries: [{ date: '1830-06-20', house: '7', names: ['Thomas', 'Petri Wesely', 'Jacobus Hajek', 'Ignatius'] }] },
      { kind: 'reading', result },
    );
    expect(score.names).toMatchObject({ truth: 4, found: 3, recall: 0.75 });
    expect(score.names.precision).toBeCloseTo(3 / 5);
    expect(score.dates).toEqual({ truth: 1, found: 1 });
    // The faded number was left empty: not found, and not guessed either.
    expect(score.houses).toEqual({ truth: 1, found: 0 });
  });

  it('scores Transkribus text by what occurs in it, and a failure as nothing read', () => {
    const text = scorePage(truth, { kind: 'text', text: 'Die 14. Martii baptizata est Anna filia Joannis Nowak coloni N. 15' });
    expect(text.names).toMatchObject({ found: 2, recall: 1, precision: null });
    expect(text.houses).toEqual({ truth: 1, found: 1 });
    expect(text.dates.found).toBeNull();
    const failed = scorePage(truth, { kind: 'failed', message: 'refused' });
    const summary = summarise('a reader', [text, failed]);
    expect(summary).toMatchObject({ pages: 2, failed: 1, namesRecall: 0.5, datesFound: null });
    expect(summaryTable([summary])).toContain('| a reader | 2 | 1 |');
  });

  describe('a whole run', () => {
    let out: string;
    let transkribus: string;
    beforeAll(async () => {
      out = await mkdtemp(join(tmpdir(), 'scan-benchmark-'));
      transkribus = await mkdtemp(join(tmpdir(), 'transkribus-'));
      await writeFile(
        join(transkribus, 'example-invented-print.txt'),
        'Anno 1830\nDie 14. Martii baptizata est Anna, filia legitima Joannis Nowak coloni N. 15',
      );
    });
    afterAll(async () => {
      await rm(out, { recursive: true, force: true });
      await rm(transkribus, { recursive: true, force: true });
    });

    it('leaves out examples unless asked, reads each sample as the server would send it, and writes the summary for design.md', async () => {
      expect(await loadSamples(SAMPLES)).toEqual([]);
      const samples = await loadSamples(SAMPLES, true);
      expect(samples.map((s) => s.id)).toEqual(['example-invented-print']);
      const api = fakeAnthropic(recording('baptism-page'));
      const summaries = await runBenchmark({
        samples,
        readers: [{ name: 'claude-opus-5-5', reader: fakeReader(api) }],
        transkribus: [{ name: 'Transkribus Kurrent', dir: transkribus }],
        out,
      });
      // The image went as the display copy, WebP, and the sample's context with it.
      const image = api.requests[0]!.body.messages[0]!.content.find((c) => c.type === 'image')!;
      expect(image.source!.media_type).toBe('image/webp');
      expect((await sharp(Buffer.from(image.source!.data, 'base64')).metadata()).width).toBe(1400);
      expect(api.requests[0]!.body.messages[0]!.content.at(-1)!.text).toContain('- Register: Invented register N 1820–1840');
      expect(summaries.map((s) => s.reader)).toEqual(['claude-opus-5-5', 'Transkribus Kurrent']);
      // The recorded reading gives the mother as "Catharinae uxoris eius", which is not the truth's "Catharinae": 4 of 5 names.
      expect(summaries[0]).toMatchObject({ pages: 1, failed: 0, namesRecall: 0.8, datesFound: 1, housesFound: 1, inputTokens: 3812 });
      expect(await readFile(join(out, 'summary.md'), 'utf8')).toMatch(/^\| Reader \| Pages/);
      expect(JSON.parse(await readFile(join(out, 'claude-opus-5-5', 'example-invented-print.json'), 'utf8'))).toHaveProperty('entries');
    });
  });
});
