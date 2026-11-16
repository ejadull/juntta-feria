/** DI token of the private object storage port; int tests replace it with an in-memory fake. */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export interface PresignedUpload {
  readonly url: string;
  /** Headers the browser must send with the PUT: they are part of the signature. */
  readonly headers: Readonly<Record<string, string>>;
}

export interface StoredObject {
  readonly sizeBytes: number;
  readonly contentType: string;
}

/**
 * Private bucket access (EXH-03). Keys are always chosen by the server; callers never hand a
 * URL or a bucket name to the storage, and nothing it returns outlives its short expiry.
 */
export interface ObjectStorage {
  presignUpload(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<PresignedUpload>;
  /** Null when the object does not exist (the upload never happened). */
  head(key: string): Promise<StoredObject | null>;
  presignDownload(input: {
    key: string;
    fileName: string;
    contentType: string;
    expiresInSeconds: number;
    /** Shown in the page (public photos) instead of forcing a download. */
    inline?: boolean;
  }): Promise<string>;
  remove(key: string): Promise<void>;
}
