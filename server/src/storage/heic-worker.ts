/**
 * Decodes one HEIC or HEIF image in a worker thread of its own (issue #147), with libheif-js:
 * libheif and the libde265 HEVC decoder compiled to WebAssembly. heic.ts starts a worker for each
 * decode and stops it after, because WebAssembly memory only grows: freed with the thread, it does
 * not stay with the API process.
 *
 * The decoded pixels stay in WebAssembly memory: sharp reads them there, cuts out the part asked
 * for and makes it at most `maxSide` pixels on its longest side, and only that smaller image is
 * copied out. A full copy would add 3 bytes a pixel to the 6 the decoder holds at its peak.
 *
 * Only Node's modules, sharp and libheif-js are imported, and only TypeScript that Node can strip:
 * under Vitest this file runs as it is, outside Vite. That is also why cropBox, which process.ts
 * uses for the other image types, is defined here.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import sharp from 'sharp';

/** The part of an image the Member marked, as shares of its width and height (as it is shown, after rotation). */
export interface Crop {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The pixels of `crop` in an image of width × height: at least one, and never outside it. */
export function cropBox(crop: Crop, width: number, height: number): { left: number; top: number; width: number; height: number } {
  const left = Math.min(width - 1, Math.max(0, Math.round(crop.left * width)));
  const top = Math.min(height - 1, Math.max(0, Math.round(crop.top * height)));
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.round(crop.width * width))),
    height: Math.max(1, Math.min(height - top, Math.round(crop.height * height))),
  };
}

/** What the worker is given: the file (transferred, not shared), the most pixels allowed, and what to make of it. */
export interface HeicJob {
  file: Uint8Array;
  maxPixels: number;
  maxSide: number;
  crop?: Crop;
}

/**
 * What it answers: the image's size as shown, and the part asked for as 8-bit RGB or RGBA rows,
 * upright, at most maxSide on its longest side; or the size when it is over maxPixels; or why not.
 */
export type HeicAnswer =
  | { width: number; height: number; pixels: ArrayBuffer; pixelsWidth: number; pixelsHeight: number; channels: 3 | 4 }
  | { tooManyPixels: true; width: number; height: number }
  | { error: string };

// The part of libheif-js's API used here (libheif's C API, wrapped by Emscripten's embind).
interface EnumValue {
  value: number;
}
interface HeifError {
  code: EnumValue;
  message: string;
}
type Context = object;
type Handle = object;
interface Plane {
  data: Uint8Array;
  stride: number;
  width: number;
  height: number;
}
interface Decoded {
  image: object;
  channels: Plane[];
}
interface LibHeif {
  heif_colorspace: { heif_colorspace_RGB: EnumValue };
  heif_chroma: { heif_chroma_interleaved_RGB: EnumValue; heif_chroma_interleaved_RGBA: EnumValue };
  heif_context_alloc(): Context;
  heif_context_free(ctx: Context): void;
  heif_context_set_maximum_image_size_limit(ctx: Context, maxWidth: number): void;
  heif_context_read_from_memory(ctx: Context, data: Uint8Array): HeifError;
  heif_js_context_get_primary_image_handle(ctx: Context): Handle | HeifError;
  heif_image_handle_get_width(handle: Handle): number;
  heif_image_handle_get_height(handle: Handle): number;
  heif_image_handle_has_alpha_channel(handle: Handle): number;
  heif_image_handle_release(handle: Handle): void;
  heif_js_decode_image2(handle: Handle, colorspace: EnumValue, chroma: EnumValue): Promise<Decoded | HeifError>;
  heif_image_release(image: object): void;
}
type Factory = (options: { wasmBinary: Uint8Array }) => LibHeif;

const isFactory = (value: unknown): value is Factory => typeof value === 'function';
const failed = (value: object): value is HeifError => 'code' in value && 'message' in value;

/** libheif, ready at once: given the WebAssembly binary, Emscripten instantiates it synchronously. */
function libheif(): LibHeif {
  const require = createRequire(import.meta.url);
  const factory: unknown = require('libheif-js/libheif-wasm/libheif.js');
  if (!isFactory(factory)) throw new Error('libheif-js has no module factory');
  return factory({ wasmBinary: readFileSync(require.resolve('libheif-js/libheif-wasm/libheif.wasm')) });
}

/**
 * Decodes the primary image of the file: the one a viewer shows when a file holds several
 * (thumbnails, depth maps and other auxiliary images never are). libheif applies the file's
 * rotation and mirroring (irot, imir) while decoding, so the rows come upright; an EXIF
 * orientation in the file is not applied again (the HEIF standard has irot win).
 */
async function decode(lib: LibHeif, job: HeicJob): Promise<HeicAnswer> {
  const ctx = lib.heif_context_alloc();
  try {
    // libheif's own limit as well, in case a tile or an item claims more than the image it makes up.
    lib.heif_context_set_maximum_image_size_limit(ctx, Math.ceil(Math.sqrt(job.maxPixels)));
    const read = lib.heif_context_read_from_memory(ctx, job.file);
    if (read.code.value !== 0) return { error: read.message };
    const handle = lib.heif_js_context_get_primary_image_handle(ctx);
    if (failed(handle)) return { error: handle.message };
    try {
      const width = lib.heif_image_handle_get_width(handle);
      const height = lib.heif_image_handle_get_height(handle);
      if (width < 1 || height < 1) return { error: 'the image has no size' };
      if (width * height > job.maxPixels) return { tooManyPixels: true, width, height };
      const channels = lib.heif_image_handle_has_alpha_channel(handle) ? 4 : 3;
      const chroma = channels === 4 ? lib.heif_chroma.heif_chroma_interleaved_RGBA : lib.heif_chroma.heif_chroma_interleaved_RGB;
      const decoded = await lib.heif_js_decode_image2(handle, lib.heif_colorspace.heif_colorspace_RGB, chroma);
      if (failed(decoded)) return { error: decoded.message };
      try {
        const plane = decoded.channels[0];
        if (!plane) return { error: 'the decoded image has no pixels' };
        return { width, height, ...(await reduce(plane, channels, job)) };
      } finally {
        lib.heif_image_release(decoded.image);
      }
    } finally {
      lib.heif_image_handle_release(handle);
    }
  } finally {
    lib.heif_context_free(ctx);
  }
}

/**
 * The part of the decoded plane asked for, at most maxSide on its longest side, made by sharp from
 * the plane where it is (its rows closed up first, in place, when libheif padded them).
 */
async function reduce(plane: Plane, channels: 3 | 4, { maxSide, crop }: HeicJob) {
  const { width, height, stride, data } = plane;
  const row = width * channels;
  if (stride !== row) for (let y = 1; y < height; y++) data.copyWithin(y * row, y * stride, y * stride + row);
  const pixels = Buffer.from(data.buffer, data.byteOffset, row * height);
  let image = sharp(pixels, { raw: { width, height, channels } });
  if (crop) image = image.extract(cropBox(crop, width, height));
  const out = await image.resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  // A copy of its own, to transfer to the API thread.
  return { pixels: new Uint8Array(out.data).buffer, pixelsWidth: out.info.width, pixelsHeight: out.info.height, channels };
}

const isJob = (data: unknown): data is HeicJob =>
  typeof data === 'object' && data !== null && 'file' in data && data.file instanceof Uint8Array && 'maxPixels' in data && 'maxSide' in data;

async function answer(job: HeicJob): Promise<HeicAnswer> {
  try {
    return await decode(libheif(), job);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

// Only as the worker heic.ts starts; imported anywhere else (process.ts, for cropBox), it does nothing.
if (!isMainThread && parentPort && isJob(workerData)) {
  const result = await answer(workerData);
  parentPort.postMessage(result, 'pixels' in result ? [result.pixels] : []);
}
