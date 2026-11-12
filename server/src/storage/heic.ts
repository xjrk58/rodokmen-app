import { Worker } from 'node:worker_threads';
import type { Crop, HeicAnswer, HeicJob } from './heic-worker.js';

/**
 * iPhone photos in HEIC (issue #147). The prebuilt sharp cannot decode them: its libvips reads
 * HEIF only with AV1 (AVIF), because HEVC is patent-encumbered. So HEIC and HEIF are decoded by
 * libheif-js, libheif with libde265 compiled to WebAssembly, and become the usual display copy and
 * crops (process.ts).
 *
 * Each decode runs in a worker thread of its own, started for it and stopped after (heic-worker.ts):
 * the decode is synchronous WebAssembly and would otherwise stop the API from answering while it
 * runs, and WebAssembly memory is never given back while the module lives. Decodes take turns
 * with every other upload (process.ts), so there is one worker at most.
 */

/**
 * The most pixels a HEIC may have. sharp reads JPEG, PNG and WebP a strip at a time, but a HEIC is
 * decoded whole, with about 6 bytes a pixel at the decoder's peak: 48 megapixels (an iPhone's
 * largest, "HEIF Max") took 375 MB above an idle process, which keeps an API slot within its
 * 512 MB (deploy/README.md, "Memory"; server/scripts/heic-memory.ts). This allows a little more,
 * and refuses before decoding a file that claims more, as sharp's own limit does for the others.
 */
export const HEIC_MAX_PIXELS = 50_000_000;

/** A decode that takes longer than this is stopped and the image refused, so the uploads behind it go ahead. */
export const HEIC_DECODE_TIMEOUT_MS = 60_000;

/** A decoded HEIC: its size as shown, and the part asked for, upright, as 8-bit RGB or RGBA rows for sharp's raw input. */
export interface DecodedHeic {
  width: number;
  height: number;
  pixels: { data: Buffer; width: number; height: number; channels: 3 | 4 };
}

/** Why a HEIC was not decoded: more pixels than HEIC_MAX_PIXELS (from its header, before decoding), or unreadable. */
export class HeicRefused extends Error {
  constructor(
    message: string,
    readonly tooManyPixels = false,
  ) {
    super(message);
    this.name = 'HeicRefused';
  }
}

const WORKER = new URL(import.meta.url.endsWith('.ts') ? './heic-worker.ts' : './heic-worker.js', import.meta.url);

let running = 0;
/** Decoders running now: one at most, as uploads take turns. */
export const heicDecodes = (): number => running;

/**
 * Decodes the primary image of `file` in a worker thread, and returns `crop` of it (or all of it)
 * at most `maxSide` pixels on its longest side. Rejects with HeicRefused when the file claims
 * more than HEIC_MAX_PIXELS, cannot be decoded, the decoder fails or stops, or the decode takes
 * longer than HEIC_DECODE_TIMEOUT_MS. Settles only once the worker has stopped, so that its
 * memory is free before the next turn.
 */
export function decodeHeic(file: Buffer, maxSide: number, crop?: Crop): Promise<DecodedHeic> {
  // A copy of its own to hand over: the caller keeps the original to store it.
  const copy = new Uint8Array(file);
  const job: HeicJob = { file: copy, maxPixels: HEIC_MAX_PIXELS, maxSide, ...(crop ? { crop } : {}) };
  const worker = new Worker(WORKER, { workerData: job, transferList: [copy.buffer] });
  running += 1;
  return new Promise<DecodedHeic>((resolve, reject) => {
    let ended = false;
    const end = (settle: () => void) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      void worker.terminate().finally(() => {
        running -= 1;
        settle();
      });
    };
    const refuse = (reason: string, tooManyPixels = false) => end(() => reject(new HeicRefused(reason, tooManyPixels)));
    const timer = setTimeout(() => refuse(`decoding took longer than ${HEIC_DECODE_TIMEOUT_MS / 1000} seconds`), HEIC_DECODE_TIMEOUT_MS);
    worker.once('message', (answer: HeicAnswer) => {
      if ('pixels' in answer) {
        const { width, height, pixels, pixelsWidth, pixelsHeight, channels } = answer;
        end(() => resolve({ width, height, pixels: { data: Buffer.from(pixels), width: pixelsWidth, height: pixelsHeight, channels } }));
      } else if ('tooManyPixels' in answer) refuse(`${answer.width} × ${answer.height} pixels`, true);
      else refuse(answer.error);
    });
    worker.once('error', (error) => refuse(error.message));
    worker.once('exit', (code) => refuse(`the decoder stopped (${code})`));
  });
}
