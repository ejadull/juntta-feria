import type {
  ObjectStorage,
  PresignedUpload,
  StoredObject,
} from '../src/storage/object-storage.js';

const UPLOAD = 'https://storage.test/upload/';
const DOWNLOAD = 'https://storage.test/download/';

/**
 * In-memory ObjectStorage (EXH-03): int tests never reach S3. "Uploading" is
 * `simulateUpload(url, ...)`; the key is read from the signed URL, as a browser would not.
 */
export class FakeObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, StoredObject>();
  readonly uploads: { key: string; contentType: string; sizeBytes: number }[] =
    [];
  readonly downloads: { key: string; expiresInSeconds: number }[] = [];

  presignUpload(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<PresignedUpload> {
    this.uploads.push({
      key: input.key,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });
    return Promise.resolve({
      url: `${UPLOAD}${input.key}?signature=fake`,
      headers: { 'Content-Type': input.contentType },
    });
  }

  head(key: string): Promise<StoredObject | null> {
    return Promise.resolve(this.objects.get(key) ?? null);
  }

  presignDownload(input: {
    key: string;
    expiresInSeconds: number;
  }): Promise<string> {
    this.downloads.push({
      key: input.key,
      expiresInSeconds: input.expiresInSeconds,
    });
    return Promise.resolve(`${DOWNLOAD}${input.key}?signature=fake`);
  }

  remove(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  /** The storage key behind a URL this fake signed. */
  keyOf(url: string): string {
    return new URL(url).pathname.replace(/^\/(upload|download)\//, '');
  }

  simulateUpload(url: string, object: StoredObject): string {
    const key = this.keyOf(url);
    this.objects.set(key, object);
    return key;
  }
}
