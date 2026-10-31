import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config.js';
import type { Clock } from '../clock.js';

/**
 * Images live in a private, S3-compatible bucket: in production, Garage in the Compose stack on
 * the VPS (deploy/docker-compose.yml). Members only ever get presigned GET links, valid for
 * {@link IMAGE_LINK_SECONDS}. The tree-model spec allows at most 10 minutes; we use 5.
 *
 * The server talks to the store at `s3.endpoint` (internal), while links are signed for
 * `s3.publicEndpoint`, the host browsers reach (files.<domain>, passed through unchanged by
 * Caddy so that the signatures stay valid).
 *
 * Uploads go straight from the phone to the bucket with a presigned PUT link into the
 * `pending/` prefix ({@link UPLOAD_LINK_SECONDS}); the server then checks the file, writes a
 * display copy, and moves both to `images/` when the Proposal is accepted.
 */
export const IMAGE_LINK_SECONDS = 5 * 60;
export const UPLOAD_LINK_SECONDS = 15 * 60;

/**
 * Where one upload's files live while it is pending. The phone writes `link` with its presigned
 * PUT, and that link stays valid for UPLOAD_LINK_SECONDS whatever the server does, so the
 * uploader could still replace the file after it was checked. Once its SHA-256 matches, the
 * checked bytes are written to `verified`, which no upload link reaches, and only that copy is
 * used from then on (issue #52); the file at `link` is deleted.
 */
export function uploadKeys(uploadId: string): { link: string; verified: string; display: string } {
  return { link: `pending/${uploadId}/original`, verified: `pending/${uploadId}/verified`, display: `pending/${uploadId}/display.webp` };
}

export interface ImageLink {
  url: string;
  expiresAt: Date;
}

export interface UploadLink extends ImageLink {
  headers: Record<string, string>;
}

export interface ImageStorage {
  /** The origin every link points at (files.<domain> in production), for the app's Content-Security-Policy. */
  linkOrigin(): Promise<string>;
  /** A presigned GET link to the object, expiring after IMAGE_LINK_SECONDS. */
  link(storageKey: string, contentType: string): Promise<ImageLink>;
  /** A presigned PUT link for exactly this content type and size. */
  uploadLink(storageKey: string, contentType: string, byteSize: number): Promise<UploadLink>;
  /** The object's bytes, or null when it does not exist. */
  get(storageKey: string): Promise<Buffer | null>;
  put(storageKey: string, body: Buffer, contentType: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  delete(storageKey: string): Promise<void>;
}

/**
 * The link for one stored image: its WebP display copy, or the original file when asked for
 * full resolution or when there is no display copy (evidence-media spec, "Originals are kept").
 */
export function imageLink(
  storage: ImageStorage,
  image: { storage_key: string; display_key: string | null; content_type: string },
  full: boolean,
): Promise<ImageLink> {
  return full || !image.display_key ? storage.link(image.storage_key, image.content_type) : storage.link(image.display_key, 'image/webp');
}

/** The client for the server's own requests, at the internal endpoint. */
export function createS3Client(s3: Config['s3']): S3Client {
  return new S3Client({
    endpoint: s3.endpoint,
    region: s3.region,
    forcePathStyle: s3.forcePathStyle,
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
  });
}

/**
 * The client that only signs links, for the public endpoint. It adds no checksums: by default
 * the SDK would sign the CRC32 of an empty body into every upload link, and the store then
 * refuses the real upload. Uploads are checked against their SHA-256 when they are completed.
 */
function createLinkSigner(s3: Config['s3']): S3Client {
  return new S3Client({
    endpoint: s3.publicEndpoint,
    region: s3.region,
    forcePathStyle: s3.forcePathStyle,
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
}

export function createImageStorage(s3: Config['s3'], clock: Clock, client: S3Client = createS3Client(s3)): ImageStorage {
  const Bucket = s3.bucket;
  const signer = createLinkSigner(s3);
  return {
    async linkOrigin() {
      // Signed like every link: path-style, or with the bucket in the host name, as the SDK decides.
      return new URL(await getSignedUrl(signer, new GetObjectCommand({ Bucket, Key: 'origin' }), { expiresIn: 60 })).origin;
    },
    async link(storageKey, contentType) {
      const signingDate = clock.now();
      const command = new GetObjectCommand({ Bucket, Key: storageKey, ResponseContentType: contentType, ResponseCacheControl: 'private, max-age=300' });
      const url = await getSignedUrl(signer, command, { expiresIn: IMAGE_LINK_SECONDS, signingDate });
      return { url, expiresAt: new Date(signingDate.getTime() + IMAGE_LINK_SECONDS * 1000) };
    },
    async uploadLink(storageKey, contentType, byteSize) {
      const signingDate = clock.now();
      const command = new PutObjectCommand({ Bucket, Key: storageKey, ContentType: contentType, ContentLength: byteSize });
      const url = await getSignedUrl(signer, command, {
        expiresIn: UPLOAD_LINK_SECONDS,
        signingDate,
        signableHeaders: new Set(['content-type', 'content-length']),
      });
      return { url, headers: { 'content-type': contentType }, expiresAt: new Date(signingDate.getTime() + UPLOAD_LINK_SECONDS * 1000) };
    },
    async get(storageKey) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket, Key: storageKey }));
        return Buffer.from(await out.Body!.transformToByteArray());
      } catch (error) {
        if (error instanceof NoSuchKey) return null;
        throw error;
      }
    },
    async put(storageKey, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket, Key: storageKey, Body: body, ContentType: contentType }));
    },
    async copy(from, to) {
      await client.send(new CopyObjectCommand({ Bucket, Key: to, CopySource: `${Bucket}/${from.split('/').map(encodeURIComponent).join('/')}` }));
    },
    async delete(storageKey) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: storageKey }));
    },
  };
}

/**
 * Object storage in memory, for tests and local development without a bucket. Links point at
 * `baseUrl` (a test server may serve them); the objects are readable through `objects`.
 */
export class MemoryImageStorage implements ImageStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  constructor(
    private readonly clock: Clock,
    public baseUrl = 'https://storage.invalid/bucket/',
  ) {}

  async linkOrigin(): Promise<string> {
    return new URL(this.baseUrl).origin;
  }
  async link(storageKey: string): Promise<ImageLink> {
    const expiresAt = new Date(this.clock.now().getTime() + IMAGE_LINK_SECONDS * 1000);
    return { url: `${this.baseUrl}${storageKey}?expires=${expiresAt.getTime()}`, expiresAt };
  }
  async uploadLink(storageKey: string, contentType: string): Promise<UploadLink> {
    const expiresAt = new Date(this.clock.now().getTime() + UPLOAD_LINK_SECONDS * 1000);
    return { url: `${this.baseUrl}${storageKey}?upload=${expiresAt.getTime()}`, headers: { 'content-type': contentType }, expiresAt };
  }
  async get(storageKey: string): Promise<Buffer | null> {
    return this.objects.get(storageKey)?.body ?? null;
  }
  async put(storageKey: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(storageKey, { body, contentType });
  }
  async copy(from: string, to: string): Promise<void> {
    const o = this.objects.get(from);
    if (!o) throw new Error(`no object ${from}`);
    this.objects.set(to, o);
  }
  async delete(storageKey: string): Promise<void> {
    this.objects.delete(storageKey);
  }
}
