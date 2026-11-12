/**
 * Measures what a HEIC upload's check costs (issue #147): the memory of this process above what it
 * held before, sampled every 2 ms, and the time, while processImage decodes the file in its worker
 * thread (heic.ts) and makes its display copy, exactly as an upload's turn does. Given a number of
 * times, it checks the file that many times one after another, as uploads take turns, and shows
 * what stays held after each, to see that nothing piles up.
 *
 *   uv run --with pillow-heif==1.8.1 python server/test/fixtures/heic/make.py --large /tmp/heic
 *   MALLOC_ARENA_MAX=2 pnpm --filter @rodokmen/server heic:memory /tmp/heic/12mp.heic [times]
 *
 * One file per run, so that one decode's memory kept by the allocator cannot hide the next one's.
 * The API slots run with MALLOC_ARENA_MAX=2 (deploy/docker-compose.yml), so measure with it too.
 */
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { processImage } from '../src/storage/process.js';

const MB = 1024 * 1024;
const [file, times = '1'] = process.argv.slice(2);
if (!file) throw new Error('Usage: heic-memory.ts <file.heic> [times]');
const original = readFileSync(file);
const mb = (bytes: number) => `${(bytes / MB).toFixed(0)} MB`;

// Warm up: load sharp and libvips, so that the baseline holds them and only the decode is measured.
await sharp({ create: { width: 64, height: 64, channels: 3, background: '#808080' } })
  .webp()
  .toBuffer();
const rss = () => process.memoryUsage.rss();
const before = rss();
console.log(`${file}: ${(original.length / MB).toFixed(1)} MB; RSS before ${mb(before)}`);
for (let turn = 1; turn <= Number(times); turn++) {
  let peak = rss();
  const sampler = setInterval(() => (peak = Math.max(peak, rss())), 2);
  const started = performance.now();
  const result = await processImage(original);
  const seconds = (performance.now() - started) / 1000;
  clearInterval(sampler);
  peak = Math.max(peak, rss());
  const display = await sharp(result.display).metadata();
  console.log(
    [
      `${turn}: ${result.width} × ${result.height} (${((result.width * result.height) / 1e6).toFixed(1)} MP) to ${display.width} × ${display.height}`,
      `${seconds.toFixed(1)} s`,
      `peak ${mb(peak)}, ${mb(peak - before)} above before`,
      `after ${mb(rss())}`,
    ].join('; '),
  );
}
