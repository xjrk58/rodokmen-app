import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { checkUpload, DISPLAY_MAX_PIXELS, processImage } from '../src/storage/process.js';
import { SerialQueue } from '../src/storage/serial-queue.js';

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

/** Lets every pending promise callback run. */
const settle = () => new Promise((r) => setImmediate(r));

/** A generated test picture (no real photo is ever committed). */
const picture = (width: number, height = 2000) =>
  sharp({ create: { width, height, channels: 3, background: { r: 90, g: 120, b: 150 } } })
    .jpeg()
    .toBuffer();

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

  it('loads an upload only in its turn, so the ones waiting hold no original yet', async () => {
    const image = await picture(1200, 900);
    const gate = deferred<Buffer>();
    const loads: string[] = [];
    let decodingWhenSecondLoads = -1;
    const first = checkUpload(() => {
      loads.push('first');
      return gate.promise;
    });
    const second = checkUpload(() => {
      loads.push('second');
      decodingWhenSecondLoads = sharp.counters().process;
      return Promise.resolve(image);
    });
    await settle();
    expect(loads).toEqual(['first']); // the second waits while the first is still loading
    gate.resolve(image);
    const [a, b] = await Promise.all([first, second]);
    expect(loads).toEqual(['first', 'second']);
    expect(decodingWhenSecondLoads).toBe(0); // and until the first one's display copy is made
    expect(a).toMatchObject({ original: image, processed: { width: 1200, height: 900 } });
    expect(b).toMatchObject({ original: image, processed: { width: 1200, height: 900 } });
  });

  it('a missing file is null, a refused image is returned, an error of loading is passed on', async () => {
    await expect(checkUpload(() => Promise.resolve(null))).resolves.toBeNull();
    const notAnImage = Buffer.from('not an image at all');
    await expect(checkUpload(() => Promise.resolve(notAnImage))).resolves.toMatchObject({
      original: notAnImage,
      refused: { statusCode: 415, code: 'unsupported_image' },
    });
    await expect(checkUpload(() => Promise.reject(new Error('storage unavailable')))).rejects.toThrow('storage unavailable');
    // The next upload gets its turn as usual.
    await expect(checkUpload(() => picture(640, 480))).resolves.toMatchObject({ processed: { width: 640, height: 480 } });
  });
});
