import { foldForSearch, type ReadingResult } from '@rodokmen/shared';
import { z } from 'zod';

/**
 * Scoring of the scan reading benchmark (add-scan-reading task 1.2): how well a reader read a
 * sample page, against the page's truth. Pure functions, tested in server/test/scan-benchmark.test.ts.
 *
 * - Character error rate (CER): the edit distance between the true transcription and the read
 *   one, divided by the length of the true one, after normalising whitespace (and nothing else:
 *   spelling, case and diacritics count).
 * - Names: the true names of the page found among the names read (recall), and the names read
 *   that are true (precision), compared folded (case and diacritics ignored).
 * - Dates and house numbers: the share of the true ones that were read exactly (the date as an
 *   EDTF date, the house number as its digits).
 *
 * Transkribus only transcribes: for its text the names and house numbers count as found when they
 * occur in the text, dates cannot be compared (the page writes "12. Martii", not 1801-03-12), and
 * precision is not defined.
 */

/** The truth of a sample page, written by whoever transcribed it by hand. */
export const SampleTruth = z.object({
  /** An example of the format only, left out of a run unless asked for. */
  example: z.boolean().default(false),
  /** Where the page is from and why it may be used: invented, or public domain with its reference. Never a Vault scan. */
  source: z.string().min(1),
  script: z.enum(['latin', 'kurrent', 'mixed', 'print']),
  languages: z.array(z.string()).min(1),
  context: z
    .object({
      sourceTitle: z.string().nullable().default(null),
      page: z.string().nullable().default(null),
      years: z.object({ from: z.number().int(), to: z.number().int() }).nullable().default(null),
      note: z.string().nullable().default(null),
    })
    .default({ sourceTitle: null, page: null, years: null, note: null }),
  transcription: z.string().min(1),
  entries: z.array(
    z.object({
      date: z.string().nullable(),
      house: z.string().nullable(),
      /** Every name of the entry as written, such as "Joannes Nowak". */
      names: z.array(z.string()),
    }),
  ),
});
export type SampleTruth = z.infer<typeof SampleTruth>;

/** What one reader made of one page: a structured reading (Claude), plain text (Transkribus), or a failure. */
export type ReaderOutput = { kind: 'reading'; result: ReadingResult } | { kind: 'text'; text: string } | { kind: 'failed'; message: string };

export interface PageScore {
  cer: number | null;
  names: { truth: number; read: number | null; found: number; precision: number | null; recall: number | null };
  dates: { truth: number; found: number | null };
  houses: { truth: number; found: number };
  failed: boolean;
}

const normalise = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim();

/** The Levenshtein distance of two texts, by code point, in O(n·m) time and O(m) memory. */
export function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const current = [i];
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost));
    }
    previous = current;
  }
  return previous[y.length]!;
}

/** Character error rate of a read transcription against the true one. */
export function characterErrorRate(truth: string, read: string): number {
  const t = normalise(truth);
  return editDistance(t, normalise(read)) / Math.max(1, [...t].length);
}

/** How many of `wanted` are in `pool`, each taken once (a multiset intersection). */
function countFound(wanted: readonly string[], pool: readonly string[]): number {
  const left = [...pool];
  let found = 0;
  for (const w of wanted) {
    const i = left.indexOf(w);
    if (i >= 0) {
      found += 1;
      left.splice(i, 1);
    }
  }
  return found;
}

const ratio = (n: number, d: number) => (d === 0 ? null : n / d);

/** The names a reading gives for a page: each person's names, as written and as given and surname. */
function readNames(result: ReadingResult): string[][] {
  return result.entries.flatMap((e) => e.persons.flatMap((p) => p.names.map((n) => [foldForSearch(n.asWritten), foldForSearch(`${n.given} ${n.surname}`)])));
}

function scoreReading(truth: SampleTruth, result: ReadingResult): PageScore {
  const text = result.pages.map((p) => p.transcription).join('\n');
  const truthNames = truth.entries.flatMap((e) => e.names.map(foldForSearch));
  const read = readNames(result);
  // A true name is found when a person's name as written, or as given name and surname, is it.
  const pool = read.map((forms) => forms.find((f) => truthNames.includes(f)) ?? forms[0]!);
  const found = countFound(truthNames, pool);
  const truthDates = truth.entries.flatMap((e) => (e.date ? [e.date] : []));
  const truthHouses = truth.entries.flatMap((e) => (e.house ? [e.house] : []));
  return {
    cer: characterErrorRate(truth.transcription, text),
    names: { truth: truthNames.length, read: pool.length, found, precision: ratio(found, pool.length), recall: ratio(found, truthNames.length) },
    dates: {
      truth: truthDates.length,
      found: countFound(
        truthDates,
        result.entries.flatMap((e) => (e.date ? [e.date] : [])),
      ),
    },
    houses: {
      truth: truthHouses.length,
      found: countFound(
        truthHouses,
        result.entries.flatMap((e) => (e.house ? [e.house] : [])),
      ),
    },
    failed: false,
  };
}

function scoreText(truth: SampleTruth, text: string): PageScore {
  const folded = ` ${foldForSearch(text)} `;
  const truthNames = truth.entries.flatMap((e) => e.names.map(foldForSearch));
  const truthHouses = truth.entries.flatMap((e) => (e.house ? [e.house] : []));
  const found = truthNames.filter((n) => folded.includes(` ${n} `) || folded.includes(n)).length;
  return {
    cer: characterErrorRate(truth.transcription, text),
    names: { truth: truthNames.length, read: null, found, precision: null, recall: ratio(found, truthNames.length) },
    dates: { truth: truth.entries.filter((e) => e.date).length, found: null },
    houses: { truth: truthHouses.length, found: truthHouses.filter((h) => new RegExp(`(^|\\D)${h}(\\D|$)`).test(text)).length },
    failed: false,
  };
}

/** The score of one reader on one page. */
export function scorePage(truth: SampleTruth, output: ReaderOutput): PageScore {
  if (output.kind === 'reading') return scoreReading(truth, output.result);
  if (output.kind === 'text') return scoreText(truth, output.text);
  return {
    cer: null,
    names: { truth: truth.entries.reduce((n, e) => n + e.names.length, 0), read: null, found: 0, precision: null, recall: 0 },
    dates: { truth: truth.entries.filter((e) => e.date).length, found: 0 },
    houses: { truth: truth.entries.filter((e) => e.house).length, found: 0 },
    failed: true,
  };
}

export interface ReaderSummary {
  reader: string;
  pages: number;
  failed: number;
  /** Mean CER over the pages it read; null when it read none. */
  cer: number | null;
  namesRecall: number | null;
  namesPrecision: number | null;
  datesFound: number | null;
  housesFound: number | null;
  inputTokens: number;
  outputTokens: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);

/** One reader over all pages: failures count as read nothing (recall 0), and CER is the mean over the pages read. */
export function summarise(
  reader: string,
  pages: readonly PageScore[],
  usage: { inputTokens: number; outputTokens: number } = { inputTokens: 0, outputTokens: 0 },
): ReaderSummary {
  const read = pages.filter((p) => !p.failed);
  const names = { truth: sum(pages.map((p) => p.names.truth)), found: sum(pages.map((p) => p.names.found)) };
  const readCounts = read.map((p) => p.names.read).filter((n): n is number => n !== null);
  const dates = pages.map((p) => p.dates.found);
  return {
    reader,
    pages: pages.length,
    failed: pages.length - read.length,
    cer: mean(read.map((p) => p.cer).filter((c): c is number => c !== null)),
    namesRecall: ratio(names.found, names.truth),
    namesPrecision: readCounts.length ? ratio(sum(read.map((p) => (p.names.read === null ? 0 : p.names.found))), sum(readCounts)) : null,
    datesFound: dates.some((d) => d === null) ? null : ratio(sum(dates.map((d) => d ?? 0)), sum(pages.map((p) => p.dates.truth))),
    housesFound: ratio(sum(pages.map((p) => p.houses.found)), sum(pages.map((p) => p.houses.truth))),
    ...usage,
  };
}

const percent = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)} %`);

/** The summary as a Markdown table, for design.md. */
export function summaryTable(summaries: readonly ReaderSummary[]): string {
  const rows = summaries.map(
    (s) =>
      `| ${s.reader} | ${s.pages} | ${s.failed} | ${percent(s.cer)} | ${percent(s.namesRecall)} | ${percent(s.namesPrecision)} | ${percent(s.datesFound)} | ${percent(s.housesFound)} | ${s.inputTokens} / ${s.outputTokens} |`,
  );
  return [
    '| Reader | Pages | Failed | CER (lower is better) | Names found | Names right | Dates right | House numbers right | Tokens in / out |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}
