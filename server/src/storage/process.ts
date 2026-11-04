import { createHash } from 'node:crypto';
import { IMAGE_MAX_BYTES, type DocumentContentType, type ImageContentType } from '@rodokmen/shared';
import sharp from 'sharp';
import { ApiProblem } from '../auth/problem.js';
import { messageOf } from '../errors.js';
import { checkDocument, type CheckedDocument } from './documents.js';
import { STORE_TIMEOUT_MS, type ImageStorage } from './images.js';
import { QueueFull, SerialQueue } from './serial-queue.js';

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
 * The most uploads (images and documents) and crops that may wait for their turn or be in it, in
 * one API slot (#97, #120). The app, the importer and the MCP server each send one upload at a
 * time, so this many means several Members at once; one more is refused with 503 and Retry-After,
 * rather than kept waiting behind one Member's pile of files. A turn takes from a fraction of a
 * second to a few seconds.
 */
export const QUEUE_LIMIT = 8;
/** How soon to try again when the queue was full: by then a turn or two have ended. */
export const BUSY_RETRY_SECONDS = 10;

/**
 * Uploads are checked one at a time, so uploads finished at the same moment cannot stack their
 * decodes, each of which can take a few hundred MB, nor their files: a document can be 50 MB
 * (#120). An upload's turn covers loading its file and writing its checked copy (and an image's
 * display copy) too (checkUpload, checkDocumentUpload), so the ones waiting hold nothing yet, and
 * the one done holds nothing any more.
 */
const turns = new SerialQueue(QUEUE_LIMIT);

/** Uploads and crops waiting for their turn or in it. */
export const queuedUploads = (): number => turns.size;

/**
 * A turn for `task`, in the order asked for. Refused with 503 while QUEUE_LIMIT are queued;
 * skipped, without running, when `gone` aborts before its turn (its request was closed, #97).
 */
async function inTurn<T>(task: () => Promise<T>, gone?: AbortSignal): Promise<T> {
  try {
    return await turns.run(task, gone);
  } catch (error) {
    if (error instanceof QueueFull) throw new ApiProblem(503, 'busy', BUSY_MESSAGE, {}, { 'retry-after': String(BUSY_RETRY_SECONDS) });
    throw error;
  }
}

export type ImageType = ImageContentType;

/** What an upload's row records of its checked image. */
export interface CheckedImage {
  contentType: ImageType;
  byteSize: number;
  sha256: string;
  width: number;
  height: number;
}

export interface ProcessedImage extends CheckedImage {
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
export const BUSY_MESSAGE = 'The server is checking other uploads just now. Try again in a few seconds.';
export const STORE_TIMEOUT_MESSAGE = 'The image store did not answer in time. Try again in a minute.';
export const CHECKSUM_MESSAGE = 'The uploaded file differs from the one announced. Upload it again.';
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
  return inTurn(() => displayCopy(original, contentType));
}

/** Where an upload's files are, and the SHA-256 it was announced with. */
export interface PendingUpload {
  /** The file the upload link put. */
  link: string;
  /** Where the checked original goes, which no upload link reaches (issue #52). */
  verified: string;
  /** Where its display copy goes. */
  display: string;
  sha256: string;
}

/** An upload checked and kept, or why it was refused. */
export type UploadCheck<T = CheckedImage> = { checked: T } | { refused: ApiProblem };

/** What the check of an upload's file found: what its row records, and the files to write. */
interface FileCheck<T> {
  checked: T;
  writes: { key: string; body: Buffer; contentType: string }[];
}

/**
 * Checks the file at `link` in one turn: loads it, runs `check` on it, and writes the files the
 * check asks for, so that nothing of an upload is held before its turn or after it (#97). Null
 * when there is no file at the link; a refusal (an ApiProblem) writes nothing; an error of the
 * store is passed on. Refused with 503 while the queue is full, and skipped when `gone` aborts
 * before its turn (inTurn).
 */
function checkInTurn<T>(
  images: ImageStorage,
  link: string,
  check: (file: Buffer) => Promise<FileCheck<T>>,
  gone?: AbortSignal,
): Promise<UploadCheck<T> | null> {
  return inTurn(async () => {
    const file = await inTime((signal) => images.get(link, signal));
    if (!file) return null;
    let result: FileCheck<T>;
    try {
      result = await check(file);
    } catch (error) {
      if (error instanceof ApiProblem) return { refused: error };
      throw error;
    }
    for (const w of result.writes) await inTime((signal) => images.put(w.key, w.body, w.contentType, signal));
    return { checked: result.checked };
  }, gone);
}

/**
 * Checks an image upload in one turn (checkInTurn): compares the file with the SHA-256 it was
 * announced with, so that a file other than the one announced costs no decode (#97), checks it as
 * processImage does, and writes the checked original and its display copy. Any number of uploads
 * finished at once hold one original, one decode and one display copy in memory, not one each.
 */
export function checkUpload(images: ImageStorage, upload: PendingUpload, gone?: AbortSignal): Promise<UploadCheck | null> {
  return checkInTurn(
    images,
    upload.link,
    async (original) => {
      const sha256 = sha256Of(original);
      if (sha256 !== upload.sha256) throw new ApiProblem(400, 'checksum', CHECKSUM_MESSAGE);
      const { display, ...checked } = await displayCopy(original, typeOf(original), sha256);
      return {
        checked,
        writes: [
          { key: upload.verified, body: original, contentType: checked.contentType },
          { key: upload.display, body: display, contentType: 'image/webp' },
        ],
      };
    },
    gone,
  );
}

/** Where a document upload's files are, and the type and SHA-256 it was announced with. */
export interface PendingDocument {
  link: string;
  verified: string;
  declared: DocumentContentType;
  sha256: string;
}

/**
 * Checks a document upload in the same queue as images (#120): its size and type (checkDocument)
 * and its SHA-256, then writes the checked copy. A document is not decoded, so its turn is short,
 * but it may be 50 MB: documents finished at once hold one file in memory, not one each, and the
 * queue's limit, its store timeouts and the skipping of closed requests cover them as they do
 * images.
 */
export function checkDocumentUpload(images: ImageStorage, upload: PendingDocument, gone?: AbortSignal): Promise<UploadCheck<CheckedDocument> | null> {
  return checkInTurn(
    images,
    upload.link,
    async (file) => {
      const checked = checkDocument(file, upload.declared);
      if (checked.sha256 !== upload.sha256) throw new ApiProblem(400, 'checksum', CHECKSUM_MESSAGE);
      return { checked, writes: [{ key: upload.verified, body: file, contentType: checked.contentType }] };
    },
    gone,
  );
}

/**
 * A read or write of the image store in a turn, given up after STORE_TIMEOUT_MS (#97): its request
 * is aborted, and the turn stops waiting for it even when the store ignores that, so the uploads
 * behind it go ahead. A decode is never cut short: two would then run at once.
 */
async function inTime<T>(io: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const deadline = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new ApiProblem(503, 'store_timeout', STORE_TIMEOUT_MESSAGE, {}, { 'retry-after': '60' }));
      deadline.abort();
    }, STORE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([io(deadline.signal), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

const sha256Of = (original: Buffer) => createHash('sha256').update(original).digest('hex');

/** The image type of an original within the size limit, or the refusal. */
function typeOf(original: Buffer): ImageType {
  if (original.length > IMAGE_MAX_BYTES) throw new ApiProblem(413, 'too_large', TOO_LARGE_MESSAGE);
  const contentType = sniffImageType(original);
  if (!contentType) throw new ApiProblem(415, 'unsupported_image', 'Only JPEG, PNG, WebP and HEIC images can be added.');
  return contentType;
}

/** The display copy; every failure becomes an ApiProblem. */
async function displayCopy(original: Buffer, contentType: ImageType, sha256 = sha256Of(original)): Promise<ProcessedImage> {
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
      sha256,
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

/** The part of an image the Member marked, as shares of its width and height (as it is shown, after EXIF rotation). */
export interface Crop {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A crop for scan reading (evidence-media spec, "Images sent for reading"): only the marked part
 * of the checked original at `key`, at most DISPLAY_MAX_PIXELS on its longest side, as WebP. The
 * original file itself never leaves the server. Loaded and decoded in its turn, like every
 * upload. Null when there is no file at `key`.
 */
export function cropForReading(images: ImageStorage, key: string, crop: Crop): Promise<Buffer | null> {
  return inTurn(async () => {
    const original = await inTime((signal) => images.get(key, signal));
    if (!original) return null;
    const meta = await sharp(original).metadata();
    if (!meta.width || !meta.height) throw new Error('an image without dimensions');
    const rotated = (meta.orientation ?? 1) >= 5;
    const width = rotated ? meta.height : meta.width;
    const height = rotated ? meta.width : meta.height;
    const left = Math.min(width - 1, Math.max(0, Math.round(crop.left * width)));
    const top = Math.min(height - 1, Math.max(0, Math.round(crop.top * height)));
    const box = {
      left,
      top,
      width: Math.max(1, Math.min(width - left, Math.round(crop.width * width))),
      height: Math.max(1, Math.min(height - top, Math.round(crop.height * height))),
    };
    return sharp(original)
      .rotate()
      .extract(box)
      .resize({ width: DISPLAY_MAX_PIXELS, height: DISPLAY_MAX_PIXELS, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  });
}
