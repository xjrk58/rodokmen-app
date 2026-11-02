import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CHECKSUM_MESSAGE, checkUpload, DISPLAY_MAX_PIXELS, processImage, type PendingUpload } from '../src/storage/process.js';
import { SerialQueue } from '../src/storage/serial-queue.js';
import { GatedStorage } from './gated-storage.js';

/** A promise with its resolve and reject at hand. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Lets every pending promise callback run. */
const settle = () => new Promise((r) => setImmediate(r));

/** A generated test picture (no real photo is ever committed). */
const picture = (width: number, height = 2000) =>
  sharp({ create: { width, height, channels: 3, background: { r: 90, g: 120, b: 150 } } })
    .jpeg()
    .toBuffer();

/** An upload whose file `body` is at its link in `storage`, announced with `sha256`. */
function pending(storage: GatedStorage, name: string, body: Buffer, sha256 = sha(body)): PendingUpload {
  storage.objects.set(`pending/${name}/original`, { body, contentType: 'image/jpeg' });
  return { link: `pending/${name}/original`, verified: `pending/${name}/verified`, display: `pending/${name}/display.webp`, sha256 };
}

describe('SerialQueue', () => {
  it('runs tasks one at a time, in the order they were queued', async () => {
    const queue = new SerialQueue();
    const started: number[] = [];
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
    const results = gates.map((gate, i) =>
      queue.run(() => {
        started.push(i);
        return gate.promise;
      }),
    );
    await settle();
    expect(started).toEqual([0]);
    expect(queue.size).toBe(3);
    gates[1]!.resolve('second'); // finished early, but waits for the first one to finish
    await settle();
    expect(started).toEqual([0]);
    gates[0]!.resolve('first');
    await settle();
    expect(started).toEqual([0, 1, 2]);
    gates[2]!.resolve('third');
    await expect(Promise.all(results)).resolves.toEqual(['first', 'second', 'third']);
    expect(queue.size).toBe(0);
  });

  it('a failing task rejects only its own promise; the next one still runs', async () => {
    const queue = new SerialQueue();
    const failing = queue.run(() => Promise.reject(new Error('cannot decode')));
    const thrown = queue.run(() => {
      throw new Error('thrown at once');
    });
    const next = queue.run(() => Promise.resolve('next'));
    await expect(failing).rejects.toThrow('cannot decode');
    await expect(thrown).rejects.toThrow('thrown at once');
    await expect(next).resolves.toBe('next');
    expect(queue.size).toBe(0);
  });
});

describe('image processing on a small server (issue #39)', () => {
  it('sets sharp to one thread and a small cache', () => {
    expect(sharp.concurrency()).toBe(1);
    const cache = sharp.cache();
    expect(cache.memory.max).toBeLessThanOrEqual(16);
    expect(cache.items.max).toBeLessThanOrEqual(10);
  });

  it('decodes one image at a time, however many uploads are checked at once', async () => {
    const pictures = await Promise.all([0, 1, 2, 3].map((i) => picture(3000 + i)));
    // sharp counts the images it is decoding and resizing right now (`process`; its `queue`
    // counter is updated from another thread, so the two cannot be added up). Sampled on every
    // turn of the event loop while the four checks run; without the queue it reaches 4.
    let most = 0;
    let sampling = true;
    const sample = () => {
      most = Math.max(most, sharp.counters().process);
      if (sampling) setImmediate(sample);
    };
    const checks = pictures.map((p) => processImage(p));
    sample();
    const results = await Promise.all(checks).finally(() => {
      sampling = false;
    });
    expect(most).toBe(1);
    expect(results.map((r) => r.width)).toEqual([3000, 3001, 3002, 3003]);
    for (const r of results) expect((await sharp(r.display).metadata()).width).toBe(DISPLAY_MAX_PIXELS);
  });

  it('a refused image does not hold up the ones after it', async () => {
    const good = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .png()
      .toBuffer();
    const broken = Buffer.concat([good.subarray(0, 64), Buffer.alloc(256, 0x55)]);
    const [refused, accepted] = await Promise.allSettled([processImage(broken), processImage(good)]);
    expect(refused).toMatchObject({ status: 'rejected', reason: { statusCode: 415, code: 'image_unreadable' } });
    expect(accepted).toMatchObject({ status: 'fulfilled', value: { contentType: 'image/png', width: 800, height: 600 } });
  });

  it('loads an upload only in its turn, and writes its files before the next one loads (#97)', async () => {
    const image = await picture(1200, 900);
    let decodingWhenSecondLoads = -1;
    const storage = new (class extends GatedStorage {
      override async get(key: string) {
        if (key === 'pending/b/original') decodingWhenSecondLoads = sharp.counters().process;
        return super.get(key);
      }
    })();
    const [a, b] = [pending(storage, 'a', image), pending(storage, 'b', image)];
    const release = storage.hold(a.link);
    const first = checkUpload(storage, a);
    const second = checkUpload(storage, b);
    await settle();
    expect(storage.log).toEqual(['get pending/a/original']); // the second waits while the first is still loading
    release();
    const results = await Promise.all([first, second]);
    // Its checked copy and display copy are written in its turn, so it holds nothing once the next one starts.
    expect(storage.log).toEqual([
      'get pending/a/original',
      'put pending/a/verified',
      'put pending/a/display.webp',
      'get pending/b/original',
      'put pending/b/verified',
      'put pending/b/display.webp',
    ]);
    expect(decodingWhenSecondLoads).toBe(0); // and until the first one's display copy is made
    for (const r of results)
      expect(r).toEqual({ checked: { contentType: 'image/jpeg', byteSize: image.length, sha256: sha(image), width: 1200, height: 900 } });
    expect(storage.objects.get('pending/a/verified')!.body.equals(image)).toBe(true);
    expect(await sharp(storage.objects.get('pending/b/display.webp')!.body).metadata()).toMatchObject({ format: 'webp', width: 1200, height: 900 });
  });

  it('a missing file is null, a refused image writes nothing, an error of the store is passed on', async () => {
    const storage = new GatedStorage();
    const none = { link: 'pending/none/original', verified: 'pending/none/verified', display: 'pending/none/display.webp', sha256: 'a'.repeat(64) };
    await expect(checkUpload(storage, none)).resolves.toBeNull();
    const notAnImage = Buffer.from('not an image at all');
    await expect(checkUpload(storage, pending(storage, 'words', notAnImage))).resolves.toMatchObject({
      refused: { statusCode: 415, code: 'unsupported_image' },
    });
    expect(storage.log.filter((l) => l.startsWith('put'))).toEqual([]);
    const broken = new (class extends GatedStorage {
      override get(): Promise<Buffer | null> {
        return Promise.reject(new Error('storage unavailable'));
      }
    })();
    await expect(checkUpload(broken, pending(broken, 'x', notAnImage))).rejects.toThrow('storage unavailable');
    // The next upload gets its turn as usual.
    await expect(checkUpload(storage, pending(storage, 'next', await picture(640, 480)))).resolves.toMatchObject({ checked: { width: 640, height: 480 } });
  });

  it('a file other than the one announced is refused before anything is decoded (#97)', async () => {
    const storage = new GatedStorage();
    const image = await picture(4000, 3000);
    let most = 0;
    let sampling = true;
    const sample = () => {
      most = Math.max(most, sharp.counters().process);
      if (sampling) setImmediate(sample);
    };
    sample();
    const checked = await checkUpload(storage, pending(storage, 'other', image, sha(Buffer.from('the file announced')))).finally(() => {
      sampling = false;
    });
    expect(checked).toMatchObject({ refused: { statusCode: 400, code: 'checksum', message: CHECKSUM_MESSAGE } });
    expect(most).toBe(0);
    // Not even its type or size is looked at: not an image, it is still told it differs.
    await expect(checkUpload(storage, pending(storage, 'words', Buffer.from('words'), sha(image)))).resolves.toMatchObject({ refused: { code: 'checksum' } });
    expect(storage.log.filter((l) => l.startsWith('put'))).toEqual([]);
  });
});
