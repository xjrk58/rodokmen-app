/**
 * The scan reading benchmark (add-scan-reading task 1.2): reads the sample pages with each Claude
 * model through the server's own reader (the same prompt, schema and image preparation), takes
 * Transkribus's transcriptions of the same pages from text files the Owner exported, scores
 * every reader against the truth of each page (score.ts), and writes the readings, a JSON
 * summary and a Markdown table for design.md.
 *
 *   ANTHROPIC_API_KEY=… pnpm --filter @rodokmen/server bench:scan \
 *     --samples <dir> [--models claude-opus-5-5,claude-sonnet-5-5] [--effort high] \
 *     [--transkribus "Transkribus Kurrent=DIR,Transkribus Latin/Kurrent=DIR"] [--out scan-benchmark-results] [--include-examples]
 *
 * The samples are invented or public-domain pages only, never scans of the Vault, and they stay
 * outside this repo (its guard refuses raster images outside app/ and test fixtures): pass their
 * directory with --samples (samples/README.md). Each Claude reading is one paid request.
 */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ReadingResult } from '@rodokmen/shared';
import sharp from 'sharp';
import { DEFAULT_SCAN_MODEL } from '../../src/config.js';
import { anthropicReader, type Effort, type Reader } from '../../src/readings/reader.js';
import { DISPLAY_MAX_PIXELS } from '../../src/storage/process.js';
import { SampleTruth, scorePage, summarise, summaryTable, type PageScore, type ReaderOutput, type ReaderSummary } from './score.js';

export interface Sample {
  id: string;
  image: string;
  truth: SampleTruth;
}

const IMAGE = /^page\.(jpe?g|png|webp|svg)$/i;

/** The samples of a directory: one sub-directory each, with page.(jpg|png|webp) and truth.json (page.svg for an invented example). */
export async function loadSamples(dir: string, includeExamples = false): Promise<Sample[]> {
  const samples: Sample[] = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const files = await readdir(join(dir, entry.name));
    const image = files.find((f) => IMAGE.test(f));
    if (!image || !files.includes('truth.json')) throw new Error(`${entry.name}: a sample needs page.jpg (or .png, .webp, .svg) and truth.json`);
    const json: unknown = JSON.parse(await readFile(join(dir, entry.name, 'truth.json'), 'utf8'));
    const truth = SampleTruth.parse(json);
    if (truth.example && !includeExamples) continue;
    samples.push({ id: entry.name, image: join(dir, entry.name, image), truth });
  }
  return samples;
}

/** The image the server would send: its display copy, WebP, at most DISPLAY_MAX_PIXELS on its longest side. */
export async function displayCopy(file: string): Promise<Buffer> {
  return sharp(await readFile(file))
    .rotate()
    .resize({ width: DISPLAY_MAX_PIXELS, height: DISPLAY_MAX_PIXELS, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
}

/** What the Member would know: the sample's context, as the server words it (without the Tree's names: there is no Tree here). */
export function contextText(truth: SampleTruth): string {
  const c = truth.context;
  const lines = ['What the Member knows about these scans (it may be incomplete, and it is not on the page):'];
  if (c.sourceTitle) lines.push(`- Register: ${c.sourceTitle}`);
  if (c.page) lines.push(`- Page or frame: ${c.page}`);
  if (c.years) lines.push(`- Years: ${c.years.from}–${c.years.to}`);
  if (c.note) lines.push(`- Note: ${c.note}`);
  if (lines.length === 1) lines.push('- Nothing.');
  return lines.join('\n');
}

/** One page read by one Claude reader, checked against the schema as the server checks it. */
async function readPage(reader: Reader, sample: Sample): Promise<{ output: ReaderOutput; raw: unknown; usage: { inputTokens: number; outputTokens: number } }> {
  const answer = await reader.read({ images: [{ data: await displayCopy(sample.image), mediaType: 'image/webp' }], context: contextText(sample.truth) });
  const usage = { inputTokens: answer.usage?.inputTokens ?? 0, outputTokens: answer.usage?.outputTokens ?? 0 };
  if (answer.kind === 'failed') return { output: { kind: 'failed', message: `${answer.code}: ${answer.message}` }, raw: answer, usage };
  const checked = ReadingResult.safeParse(answer.json);
  if (!checked.success) return { output: { kind: 'failed', message: `invalid_result: ${checked.error.issues[0]?.message ?? ''}` }, raw: answer.json, usage };
  return { output: { kind: 'reading', result: checked.data }, raw: checked.data, usage };
}

export interface BenchmarkOptions {
  samples: readonly Sample[];
  readers: ReadonlyArray<{ name: string; reader: Reader }>;
  /** Transcriptions exported from Transkribus: by model name, a directory with <sample id>.txt. */
  transkribus: ReadonlyArray<{ name: string; dir: string }>;
  out: string;
  log?: (line: string) => void;
}

/** Runs every reader on every sample, writes what each read and the summary, and returns the summary. */
export async function runBenchmark(o: BenchmarkOptions): Promise<ReaderSummary[]> {
  const log = o.log ?? (() => undefined);
  await mkdir(o.out, { recursive: true });
  const summaries: ReaderSummary[] = [];
  const pages: Record<string, Record<string, PageScore>> = {};
  for (const { name, reader } of o.readers) {
    const scores: PageScore[] = [];
    const usage = { inputTokens: 0, outputTokens: 0 };
    await mkdir(join(o.out, name), { recursive: true });
    for (const sample of o.samples) {
      log(`${name}: ${sample.id}`);
      const read = await readPage(reader, sample);
      usage.inputTokens += read.usage.inputTokens;
      usage.outputTokens += read.usage.outputTokens;
      await writeFile(join(o.out, name, `${sample.id}.json`), `${JSON.stringify(read.raw, null, 2)}\n`);
      const score = scorePage(sample.truth, read.output);
      scores.push(score);
      (pages[name] ??= {})[sample.id] = score;
    }
    summaries.push(summarise(name, scores, usage));
  }
  for (const { name, dir } of o.transkribus) {
    const scores: PageScore[] = [];
    for (const sample of o.samples) {
      const text = await readFile(join(dir, `${sample.id}.txt`), 'utf8').catch(() => null);
      const score = scorePage(sample.truth, text === null ? { kind: 'failed', message: 'no export' } : { kind: 'text', text });
      scores.push(score);
      (pages[name] ??= {})[sample.id] = score;
    }
    summaries.push(summarise(name, scores));
  }
  await writeFile(join(o.out, 'summary.json'), `${JSON.stringify({ samples: o.samples.map((s) => s.id), summaries, pages }, null, 2)}\n`);
  await writeFile(join(o.out, 'summary.md'), `${summaryTable(summaries)}\n`);
  return summaries;
}

const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const isEffort = (v: string): v is Effort => EFFORTS.includes(v);

async function main() {
  const { values } = parseArgs({
    options: {
      samples: { type: 'string', default: resolve(import.meta.dirname, 'samples') },
      models: { type: 'string', default: `${DEFAULT_SCAN_MODEL},claude-sonnet-5-5` },
      effort: { type: 'string', default: 'high' },
      transkribus: { type: 'string', default: '' },
      out: { type: 'string', default: 'scan-benchmark-results' },
      'include-examples': { type: 'boolean', default: false },
    },
  });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Set ANTHROPIC_API_KEY: the benchmark reads each page with the Anthropic API (a paid request per page and model).');
  const effort = values.effort;
  if (!isEffort(effort)) throw new Error('--effort is one of low, medium, high, xhigh, max');
  const samples = await loadSamples(values.samples, values['include-examples']);
  if (samples.length === 0) throw new Error(`No samples in ${values.samples} (samples/README.md says how to add them).`);
  const readers = values.models
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
    .map((model) => ({ name: model, reader: anthropicReader({ apiKey, model, effort }) }));
  const transkribus = values.transkribus
    .split(',')
    .map((pair) => pair.split('='))
    .filter((p): p is [string, string] => p.length === 2 && p[0]!.trim() !== '')
    .map(([name, dir]) => ({ name: name.trim(), dir: dir.trim() }));
  const summaries = await runBenchmark({ samples, readers, transkribus, out: values.out, log: (line) => console.log(line) });
  console.log(`\n${summaryTable(summaries)}\n\nWritten to ${values.out}/ (summary.md, summary.json, and each reading).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
