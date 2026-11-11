import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { decodeHeic, HEIC_DECODE_TIMEOUT_MS, HEIC_MAX_PIXELS, heicDecodes, HeicRefused } from '../src/storage/heic.js';
import { cropForReading, HEIC_TOO_MANY_PIXELS_MESSAGE, processImage } from '../src/storage/process.js';
import { GatedStorage } from './gated-storage.js';

/**
 * HEIC and HEIF, decoded by libheif-js in a worker thread (issue #147). The files are invented
 * (test/fixtures/heic/make.py); the upload of one through the API is in uploads.test.ts.
 */
const fixture = (name: string) => readFileSync(new URL(`fixtures/heic/${name}`, import.meta.url));

/** The colour of the pixel at x, y of an encoded image. */
async function colourAt(image: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [...data.subarray(at, at + 3)];
}

/** Each channel of `actual` within `slack` of `expected` (HEVC and WebP are lossy). */
const near = (actual: number[], expected: number[], slack = 24) => actual.every((v, i) => Math.abs(v - expected[i]!) <= slack);

/** `file` with the size in its ispe box (the image's size in its header) changed to width × height. */
function claiming(file: Buffer, width: number, height: number): Buffer {
  const out = Buffer.from(file);
  const ispe = out.indexOf('ispe', 0, 'latin1');
  expect(ispe).toBeGreaterThan(0);
  out.writeUInt32BE(width, ispe + 8); // after the type, a version byte and three bytes of flags
  out.writeUInt32BE(height, ispe + 12);
  return out;
}

describe('HEIC photos (issue #147)', () => {
  it('shows the primary image of a file that holds several', async () => {
    // The first image is red and 80 × 60; the second, the primary one, is green and 120 × 90, with a thumbnail.
    const done = await processImage(fixture('two-images.heic'));
    expect(done).toMatchObject({ contentType: 'image/heic', width: 120, height: 90 });
    expect(await sharp(done.display).metadata()).toMatchObject({ format: 'webp', width: 120, height: 90 });
    expect(near(await colourAt(done.display, 60, 45), [30, 200, 60])).toBe(true);
  });

  it('applies the rotation of the file once: irot, not EXIF orientation on top of it', async () => {
    const done = await processImage(fixture('rotated.heic'));
    expect(done).toMatchObject({ width: 64, height: 96 });
    expect(near(await colourAt(done.display, 48, 10), [40, 40, 200])).toBe(true); // the marked quarter, now at the top right
    expect(near(await colourAt(done.display, 10, 60), [200, 40, 40])).toBe(true);
  });

  it('converts 10 bits a colour down to the 8 of the display copy', async () => {
    const done = await processImage(fixture('ten-bit.heic'));
    expect(done).toMatchObject({ width: 64, height: 48 });
    expect(near(await colourAt(done.display, 32, 24), [90, 120, 200])).toBe(true);
  });

  it('cuts a crop for reading out of the upright image, at full resolution', async () => {
    const storage = new GatedStorage();
    storage.objects.set('images/rotated', { body: fixture('rotated.heic'), contentType: 'image/heic' });
    const crop = await cropForReading(storage, 'images/rotated', { left: 0.5, top: 0, width: 0.5, height: 0.5 });
    expect(await sharp(crop!).metadata()).toMatchObject({ format: 'webp', width: 32, height: 48 });
    expect(near(await colourAt(crop!, 16, 24), [40, 40, 200])).toBe(true);

    storage.objects.set('images/portrait', { body: fixture('portrait-12mp.heic'), contentType: 'image/heic' });
    const page = await cropForReading(storage, 'images/portrait', { left: 0.25, top: 0.25, width: 0.25, height: 0.25 });
    expect(await sharp(page!).metadata()).toMatchObject({ width: 756, height: 1008 }); // a quarter of 3,024 × 4,032, not of the display copy
  });

  it('refuses from its header a HEIC with more pixels than HEIC_MAX_PIXELS, before decoding it', async () => {
    expect(HEIC_MAX_PIXELS).toBe(50_000_000);
    expect(HEIC_TOO_MANY_PIXELS_MESSAGE).toBe('HEIC photos can have at most 50 million pixels. Take the photo at a lower resolution, or share it as JPEG.');
    const huge = claiming(fixture('rotated.heic'), 10_000, 5_001); // 50,010,000 pixels in a file of 649 bytes
    await expect(decodeHeic(huge, 2000)).rejects.toMatchObject({ name: 'HeicRefused', tooManyPixels: true });
    await expect(processImage(huge)).rejects.toMatchObject({ statusCode: 413, code: 'too_large', message: HEIC_TOO_MANY_PIXELS_MESSAGE });
    // Just within the limit, it gets as far as decoding, and fails there: the data is for 96 × 64 pixels.
    await expect(processImage(claiming(fixture('rotated.heic'), 10_000, 5_000))).rejects.toMatchObject({ statusCode: 415, code: 'image_unreadable' });
  });

  it('decodes one HEIC at a time in one worker, and a damaged one does not hold up the others', async () => {
    const files = [fixture('portrait-12mp.heic'), fixture('rotated.heic').subarray(0, 300), fixture('two-images.heic'), fixture('portrait-12mp.heic')];
    let most = 0;
    let sampling = true;
    const sample = () => {
      most = Math.max(most, heicDecodes());
      if (sampling) setImmediate(sample);
    };
    const checks = Promise.allSettled(files.map((f) => processImage(f)));
    sample();
    const results = await checks.finally(() => {
      sampling = false;
    });
    expect(most).toBe(1);
    expect(heicDecodes()).toBe(0);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
    expect(results[1]).toMatchObject({ reason: { statusCode: 415, code: 'image_unreadable' } });
    expect(results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.height] : []))).toEqual([4032, 90, 4032]);
  });

  it("leaves sharp's one thread and small cache as they were: loading sharp in the worker must not reset them", async () => {
    // sharp sets its default cache whenever it is loaded, and libvips's settings are the whole process's.
    await processImage(fixture('rotated.heic'));
    expect(sharp.concurrency()).toBe(1);
    const cache = sharp.cache();
    expect([cache.memory.max, cache.files.max, cache.items.max]).toEqual([16, 0, 10]);
  });

  it('stops a decode that takes longer than HEIC_DECODE_TIMEOUT_MS, and refuses the image', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const decoding = decodeHeic(fixture('portrait-12mp.heic'), 2000);
      const refused = expect(decoding).rejects.toBeInstanceOf(HeicRefused);
      expect(heicDecodes()).toBe(1);
      await vi.advanceTimersByTimeAsync(HEIC_DECODE_TIMEOUT_MS);
      await refused;
      await expect(decoding).rejects.toThrow(`decoding took longer than ${HEIC_DECODE_TIMEOUT_MS / 1000} seconds`);
      expect(heicDecodes()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
