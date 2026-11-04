import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { STORE_TIMEOUT_MS } from '../src/storage/images.js';
import { NOT_A_PDF_MESSAGE } from '../src/storage/documents.js';
import {
  CHECKSUM_MESSAGE,
  checkDocumentUpload,
  checkUpload,
  cropForReading,
  DISPLAY_MAX_PIXELS,
  processImage,
  type PendingDocument,
  type PendingUpload,
} from '../src/storage/process.js';
import { QueueFull, SerialQueue } from '../src/storage/serial-queue.js';
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

/** A document upload whose file `body` is at its link in `storage`, announced as a PDF with `sha256`. */
function pendingDocument(storage: GatedStorage, name: string, body: Buffer, sha256 = sha(body)): PendingDocument {
  storage.objects.set(`pending/${name}/original`, { body, contentType: 'application/pdf' });
  return { link: `pending/${name}/original`, verified: `pending/${name}/verified`, declared: 'application/pdf', sha256 };
}

/** A minimal invented PDF. */
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n% Invented chronicle\n', 'latin1'), Buffer.alloc(2048, 0x20), Buffer.from('\n%%EOF\n')]);

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
  it('refuses a task beyond its limit at once, and takes one again when a place is free (#97)', async () => {
    const queue = new SerialQueue(2);
    const gate = deferred();
    const first = queue.run(() => gate.promise);
    const second = queue.run(() => Promise.resolve('second'));
    await expect(queue.run(() => Promise.resolve('third'))).rejects.toBeInstanceOf(QueueFull);
    expect(queue.size).toBe(2);
    gate.resolve();
    await Promise.all([first, second]);
    await expect(queue.run(() => Promise.resolve('again'))).resolves.toBe('again');
  });

  it('skips a task whose signal aborts before its turn, and frees its place at once (#97)', async () => {
    const queue = new SerialQueue(2);
    const gate = deferred();
    const ran: string[] = [];
    const first = queue.run(() => {
      ran.push('first');
      return gate.promise;
    });
    const gone = new AbortController();
    const skipped = expect(queue.run(async () => void ran.push('skipped'), gone.signal)).rejects.toThrow('the request was closed');
    expect(queue.size).toBe(2);
    gone.abort(new Error('the request was closed'));
    expect(queue.size).toBe(1);
    const next = queue.run(async () => void ran.push('next'));
    // Aborted already: refused at once, without taking a place.
    await expect(queue.run(async () => void ran.push('late'), gone.signal)).rejects.toThrow('the request was closed');
    expect(queue.size).toBe(2);
    gate.resolve();
    await Promise.all([first, skipped, next]);
    expect(ran).toEqual(['first', 'next']);

    // Once a task runs, its signal no longer matters: it ends as usual.
    const running = new AbortController();
    const end = deferred<string>();
    const task = queue.run(() => end.promise, running.signal);
    await settle();
    running.abort(new Error('gone while running'));
    expect(queue.size).toBe(1);
    end.resolve('done');
    await expect(task).resolves.toBe('done');
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
    storage.hold(a.link);
    const first = checkUpload(storage, a);
    const second = checkUpload(storage, b);
    try {
      await settle();
      expect(storage.log).toEqual(['get pending/a/original']); // the second waits while the first is still loading
    } finally {
      storage.releaseAll();
    }
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

  it('a stalled read of the store is given up after STORE_TIMEOUT_MS, and the uploads behind it go ahead (#97)', async () => {
    const storage = new GatedStorage();
    const image = await picture(800, 600);
    const stalled = pending(storage, 'stalled', image);
    const crop = pending(storage, 'scan', image);
    storage.hold(stalled.link); // and never let go: a store that ignores the abort too
    storage.hold(crop.link);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const first = expect(checkUpload(storage, stalled)).rejects.toMatchObject({
        statusCode: 503,
        code: 'store_timeout',
        headers: { 'retry-after': '60' },
      });
      // A reading's crop and a document take their turns in the same queue, and are given up the same way (#120).
      const reading = expect(cropForReading(storage, crop.link, { left: 0, top: 0, width: 0.5, height: 0.5 })).rejects.toMatchObject({
        code: 'store_timeout',
      });
      const stalledDocument = pendingDocument(storage, 'chronicle', PDF);
      storage.hold(stalledDocument.link);
      const document = expect(checkDocumentUpload(storage, stalledDocument)).rejects.toMatchObject({
        statusCode: 503,
        code: 'store_timeout',
        headers: { 'retry-after': '60' },
      });
      const next = checkUpload(storage, pending(storage, 'next', image));
      await vi.advanceTimersByTimeAsync(STORE_TIMEOUT_MS - 1);
      expect(storage.log).toEqual(['get pending/stalled/original']);
      await vi.advanceTimersByTimeAsync(1);
      await first;
      expect(storage.signals.get(stalled.link)?.aborted).toBe(true); // the request to the store is aborted
      await vi.advanceTimersByTimeAsync(STORE_TIMEOUT_MS);
      await reading;
      await vi.advanceTimersByTimeAsync(STORE_TIMEOUT_MS);
      await document;
      expect(storage.signals.get(stalledDocument.link)?.aborted).toBe(true);
      vi.useRealTimers();
      await expect(next).resolves.toMatchObject({ checked: { width: 800, height: 600 } });
    } finally {
      vi.useRealTimers();
      storage.releaseAll();
    }
  });

  it('checks a document in its turn: missing is null, refused writes nothing, checked writes its copy (#120)', async () => {
    const storage = new GatedStorage();
    const none: PendingDocument = { link: 'pending/none/original', verified: 'pending/none/verified', declared: 'application/pdf', sha256: sha(PDF) };
    await expect(checkDocumentUpload(storage, none)).resolves.toBeNull();
    await expect(checkDocumentUpload(storage, pendingDocument(storage, 'other', PDF, sha(Buffer.from('the file announced'))))).resolves.toMatchObject({
      refused: { statusCode: 400, code: 'checksum', message: CHECKSUM_MESSAGE },
    });
    const doc = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512, 0)]);
    await expect(checkDocumentUpload(storage, pendingDocument(storage, 'doc', doc))).resolves.toMatchObject({
      refused: { statusCode: 415, code: 'unsupported_document', message: NOT_A_PDF_MESSAGE },
    });
    expect(storage.log.filter((l) => l.startsWith('put'))).toEqual([]);
    await expect(checkDocumentUpload(storage, pendingDocument(storage, 'chronicle', PDF))).resolves.toEqual({
      checked: { contentType: 'application/pdf', byteSize: PDF.length, sha256: sha(PDF) },
    });
    expect(storage.log.slice(-2)).toEqual(['get pending/chronicle/original', 'put pending/chronicle/verified']);
    expect(storage.objects.get('pending/chronicle/verified')).toEqual({ body: PDF, contentType: 'application/pdf' });
  });
});
