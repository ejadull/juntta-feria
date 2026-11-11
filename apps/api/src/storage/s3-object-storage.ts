import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfiguration } from '../config/configuration.js';
import type {
  ObjectStorage,
  PresignedUpload,
  StoredObject,
} from './object-storage.js';

type S3Settings = AppConfiguration['s3'];

const UNSAFE_NAME_CHARS = new Set([
  '"',
  String.fromCharCode(92),
  '/',
  ':',
  '*',
  '?',
  '<',
  '>',
  '|',
]);
const NON_ASCII = /[^ -~]/g;

/** Control characters, quotes and path separators become `_`. */
const sanitize = (name: string): string =>
  Array.from(name, (ch) => {
    const code = ch.codePointAt(0)!;
    return code < 0x20 || code === 0x7f || UNSAFE_NAME_CHARS.has(ch) ? '_' : ch;
  }).join('');

/** `attachment` with an ASCII fallback and the RFC 5987 UTF-8 name; never trusts the stored name. */
export function contentDisposition(fileName: string): string {
  const clean = sanitize(fileName).trim().slice(0, 150) || 'documento';
  const ascii = clean.replace(NON_ASCII, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

/**
 * S3 adapter (LocalStack in development). Two clients: one reaches the endpoint from inside the
 * API (HEAD/DELETE), the other signs URLs for the host the browser can reach (`publicEndpoint`).
 */
export class S3ObjectStorage implements ObjectStorage {
  private readonly internal: S3Client;
  private readonly signer: S3Client;
  private readonly bucket: string;

  constructor(settings: S3Settings) {
    this.bucket = settings.bucket;
    const base = {
      region: settings.region,
      forcePathStyle: settings.forcePathStyle,
      credentials: {
        accessKeyId: settings.accessKey,
        secretAccessKey: settings.secretKey,
      },
      // Checksum headers would become part of the signature and break browser uploads.
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
    };
    this.internal = new S3Client({
      ...base,
      endpoint: settings.endpoint,
      maxAttempts: 2,
    });
    this.signer = new S3Client({ ...base, endpoint: settings.publicEndpoint });
  }

  async presignUpload(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<PresignedUpload> {
    const url = await getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.sizeBytes,
      }),
      {
        expiresIn: input.expiresInSeconds,
        // Signed: S3 rejects a body of another size or type than the one validated here.
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    return { url, headers: { 'Content-Type': input.contentType } };
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const out = await this.internal.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        sizeBytes: out.ContentLength ?? 0,
        contentType: out.ContentType ?? '',
      };
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        (error.$metadata.httpStatusCode === 404 || error.name === 'NotFound')
      )
        return null;
      throw error;
    }
  }

  presignDownload(input: {
    key: string;
    fileName: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        ResponseContentType: input.contentType,
        ResponseContentDisposition: contentDisposition(input.fileName),
      }),
      { expiresIn: input.expiresInSeconds },
    );
  }

  async remove(key: string): Promise<void> {
    await this.internal.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
