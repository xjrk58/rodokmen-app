import { createHash } from 'node:crypto';
import { IMAGE_MAX_BYTES, type ImageContentType } from '@rodokmen/shared';
import sharp from 'sharp';
import { ApiProblem } from '../auth/problem.js';
import { messageOf } from '../errors.js';
import { SerialQueue } from './serial-queue.js';

/** Longest side of the display copy (evidence-media spec, "Originals are kept"). */
export const DISPLAY_MAX_PIXELS = 2000;

/**
 * The most pixels an upload may have: sharp's own default limit (`limitInputPixels`, 16,383 ×
 * 16,383), which sharp applies when decoding. It is checked here first, from the file's header,
 * so that a file claiming more, typically a small one that would decode to a huge image, is
 * refused with a clear message before anything is decoded (issue #98).
 */
export const SHARP_MAX_INPUT_PIXELS = 0x3fff * 0x3fff;

// Memory on the 4 GB server (issue #39, deploy/README.md, "Memory"): libvips decodes with one
// thread, and keeps only a small cache of operations, since each upload is decoded once.
sharp.concurrency(1);
sharp.cache({ memory: 16, items: 10, files: 0 });

/**
 * Images are checked one at a time, so uploads finished at the same moment cannot stack their
 * decodes, each of which can take a few hundred MB. An upload's turn also covers loading its
 * original (checkUpload), so the ones waiting hold nothing yet.
 */
const turns = new SerialQueue();

export type ImageType = ImageContentType;

export interface ProcessedImage {
  contentType: ImageType;
  byteSize: number;
  sha256: string;
  width: number;
  height: number;
  /** WebP, at most DISPLAY_MAX_PIXELS on its longest side. */
  display: Buffer;
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis']);
const HEIF_BRANDS = new Set(['mif1', 'msf1']);

/** The type of an image from its first bytes; the declared type is not trusted. */
export function sniffImageType(buf: Buffer): ImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') {
    const brand = buf.toString('latin1', 8, 12);
    if (HEIC_BRANDS.has(brand)) return 'image/heic';
    if (HEIF_BRANDS.has(brand)) return 'image/heif';
  }
  return null;
}

export const TOO_LARGE_MESSAGE = 'Images can be at most 25 MB. Take the photo at a lower resolution or export a smaller copy.';
export const TOO_MANY_PIXELS_MESSAGE = `Images can have at most about ${Math.round(SHARP_MAX_INPUT_PIXELS / 1_000_000)} million pixels. Take the photo at a lower resolution or export a smaller copy.`;
export const HEIC_MESSAGE =
  'This HEIC photo could not be converted. On an iPhone, set Settings → Camera → Formats → Most Compatible, or share the photo as JPEG, then add it again.';

/**
 * Checks an uploaded original and makes its display copy: JPEG, PNG, WebP or HEIC up to
 * 25 MB and SHARP_MAX_INPUT_PIXELS. HEIC is converted here; when the image library cannot
 * decode it, the upload is refused with a message saying what to do. Size and type are checked at once;
 * the decode waits for the images before it (one at a time).
 */
export async function processImage(original: Buffer): Promise<ProcessedImage> {
  const contentType = typeOf(original);
  return turns.run(() => displayCopy(original, contentType));
}

/** An upload's original, loaded in its turn, with its display copy or why it was refused. */
export type UploadCheck = { original: Buffer } & ({ processed: ProcessedImage } | { refused: ApiProblem });

/**
 * Loads an upload's original with `load`, then checks it as processImage does, in one turn: any
 * number of uploads finished at once hold one original and one decode in memory, not one each.
 * Null when `load` finds no file; an error of `load` itself is passed on.
 */
export function checkUpload(load: () => Promise<Buffer | null>): Promise<UploadCheck | null> {
  return turns.run(async () => {
    const original = await load();
    if (!original) return null;
    try {
      return { original, processed: await displayCopy(original, typeOf(original)) };
    } catch (error) {
      if (error instanceof ApiProblem) return { original, refused: error };
      throw error;
    }
  });
}

/** The image type of an original within the size limit, or the refusal. */
function typeOf(original: Buffer): ImageType {
  if (original.length > IMAGE_MAX_BYTES) throw new ApiProblem(413, 'too_large', TOO_LARGE_MESSAGE);
  const contentType = sniffImageType(original);
  if (!contentType) throw new ApiProblem(415, 'unsupported_image', 'Only JPEG, PNG, WebP and HEIC images can be added.');
  return contentType;
}

/** The display copy; every failure becomes an ApiProblem. */
async function displayCopy(original: Buffer, contentType: ImageType): Promise<ProcessedImage> {
  const heic = contentType === 'image/heic' || contentType === 'image/heif';
  try {
    // The header alone, without sharp's limit, so a file over it is told apart from an unreadable one.
    const meta = await sharp(original, { failOn: 'error', limitInputPixels: false }).metadata();
    if (!meta.width || !meta.height) throw new Error('no dimensions');
    if (meta.width * meta.height > SHARP_MAX_INPUT_PIXELS) throw new ApiProblem(413, 'too_large', TOO_MANY_PIXELS_MESSAGE);
    const image = sharp(original, { failOn: 'error' });
    const rotated = (meta.orientation ?? 1) >= 5;
    const display = await image
      .rotate()
      .resize({ width: DISPLAY_MAX_PIXELS, height: DISPLAY_MAX_PIXELS, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    return {
      contentType,
      byteSize: original.length,
      sha256: createHash('sha256').update(original).digest('hex'),
      width: rotated ? meta.height : meta.width,
      height: rotated ? meta.width : meta.height,
      display,
    };
  } catch (error) {
    if (error instanceof ApiProblem) throw error;
    if (heic) throw new ApiProblem(415, 'heic_unsupported', HEIC_MESSAGE);
    throw new ApiProblem(415, 'image_unreadable', `This image could not be read (${messageOf(error)}). Try another copy of it.`);
  }
}
