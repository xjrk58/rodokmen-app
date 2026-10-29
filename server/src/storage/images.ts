import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config.js';
import type { Clock } from '../tree/summaries.js';

/**
 * Images live in a private, S3-compatible bucket (Hetzner Object Storage in production).
 * Members only ever get presigned GET links, valid for {@link IMAGE_LINK_SECONDS}. The
 * tree-model spec allows at most 10 minutes; we use 5.
 */
export const IMAGE_LINK_SECONDS = 5 * 60;

export interface ImageLink {
  url: string;
  expiresAt: Date;
}

export interface ImageStorage {
  /** A presigned GET link to the object, expiring after IMAGE_LINK_SECONDS. */
  link(storageKey: string, contentType: string): Promise<ImageLink>;
}

export function createS3Client(s3: Config['s3']): S3Client {
  return new S3Client({
    endpoint: s3.endpoint,
    region: s3.region,
    forcePathStyle: s3.forcePathStyle,
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
  });
}

export function createImageStorage(s3: Config['s3'], clock: Clock, client: S3Client = createS3Client(s3)): ImageStorage {
  return {
    async link(storageKey, contentType) {
      const signingDate = clock.now();
      const command = new GetObjectCommand({ Bucket: s3.bucket, Key: storageKey, ResponseContentType: contentType, ResponseCacheControl: 'private, max-age=300' });
      const url = await getSignedUrl(client, command, { expiresIn: IMAGE_LINK_SECONDS, signingDate });
      return { url, expiresAt: new Date(signingDate.getTime() + IMAGE_LINK_SECONDS * 1000) };
    },
  };
}
