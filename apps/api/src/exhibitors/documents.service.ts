import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, eq, isNotNull, type SQL } from 'drizzle-orm';
import { DatabaseService, type Transaction } from '../db/database.service.js';
import { exhibitorDocuments, exhibitors } from '../db/schema.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../storage/object-storage.js';
import { AuditService } from '../tenancy/audit.service.js';
import {
  DOWNLOAD_URL_TTL_SECONDS,
  MAX_DOCUMENT_BYTES,
  UPLOAD_URL_TTL_SECONDS,
  documentKey,
} from './document-policy.js';
import type { RequestUploadInput, ReviewInput } from './document.input.js';

const view = {
  id: exhibitorDocuments.id,
  exhibitorId: exhibitorDocuments.exhibitorId,
  type: exhibitorDocuments.type,
  status: exhibitorDocuments.status,
  fileName: exhibitorDocuments.fileName,
  contentType: exhibitorDocuments.contentType,
  sizeBytes: exhibitorDocuments.sizeBytes,
  uploadedAt: exhibitorDocuments.uploadedAt,
  reviewedAt: exhibitorDocuments.reviewedAt,
  rejectionReason: exhibitorDocuments.rejectionReason,
  createdAt: exhibitorDocuments.createdAt,
};

/** Never includes the storage key or who reviewed: those stay server-side. */
export type ExhibitorDocument = {
  id: string;
  exhibitorId: string;
  type: string;
  status: string;
  fileName: string;
  contentType: string;
  sizeBytes: number | null;
  uploadedAt: Date | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
};

export type UploadTicket = {
  document: ExhibitorDocument;
  upload: {
    url: string;
    method: 'PUT';
    headers: Readonly<Record<string, string>>;
    expiresAt: Date;
  };
};

export type DownloadTicket = {
  url: string;
  fileName: string;
  expiresAt: Date;
};

type StoredDocument = ExhibitorDocument & { storageKey: string };

const NO_PROFILE = 'You have no exhibitor profile in this organization yet.';
const NOT_FOUND = 'Document not found.';

/** EXH-03: private documents of an exhibitor, uploaded straight to storage with presigned URLs. */
@Injectable()
export class ExhibitorDocumentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  // ---- the exhibitor's own documents -------------------------------------------------------

  listOwn(tenantId: string, userId: string): Promise<ExhibitorDocument[]> {
    return this.database.withTenant(tenantId, async (tx) =>
      this.list(tx, await this.ownExhibitorId(tx, userId)),
    );
  }

  /** Registers the document and signs a PUT for exactly this type and size. */
  requestUpload(
    tenantId: string,
    userId: string,
    input: RequestUploadInput,
  ): Promise<UploadTicket> {
    return this.database.withTenant(tenantId, async (tx) => {
      const exhibitorId = await this.ownExhibitorId(tx, userId);
      const id = crypto.randomUUID();
      const storageKey = documentKey(tenantId, exhibitorId, id);
      await tx.insert(exhibitorDocuments).values({
        id,
        exhibitorId,
        type: input.type,
        storageKey,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        uploadedBy: userId,
      });
      const signed = await this.storage.presignUpload({
        key: storageKey,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      });
      return {
        document: await this.read(tx, eq(exhibitorDocuments.id, id)),
        upload: {
          url: signed.url,
          method: 'PUT' as const,
          headers: signed.headers,
          expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000),
        },
      };
    });
  }

  /**
   * Confirms the upload by asking the storage what it really holds: a missing object, another
   * type or a size over the limit never becomes a reviewable document (the object is removed).
   */
  async complete(
    tenantId: string,
    userId: string,
    documentId: string,
  ): Promise<ExhibitorDocument> {
    let rejected = false;
    const result = await this.database.withTenant(tenantId, async (tx) => {
      const exhibitorId = await this.ownExhibitorId(tx, userId);
      const doc = await this.stored(tx, exhibitorId, documentId);
      if (doc.uploadedAt) return this.publicView(doc);
      const object = await this.storage.head(doc.storageKey);
      if (!object)
        throw new ConflictException({
          message: 'The file was not uploaded yet.',
          code: 'UPLOAD_MISSING',
        });
      const valid =
        object.sizeBytes > 0 &&
        object.sizeBytes <= MAX_DOCUMENT_BYTES &&
        object.contentType.toLowerCase() === doc.contentType;
      if (!valid) {
        await this.storage.remove(doc.storageKey);
        await tx
          .delete(exhibitorDocuments)
          .where(eq(exhibitorDocuments.id, documentId));
        rejected = true;
        return null;
      }
      await tx
        .update(exhibitorDocuments)
        .set({ uploadedAt: new Date(), sizeBytes: object.sizeBytes })
        .where(eq(exhibitorDocuments.id, documentId));
      const after = await this.read(tx, eq(exhibitorDocuments.id, documentId));
      await this.audit.record(tx, {
        actorId: userId,
        action: 'exhibitor_document.uploaded',
        entityType: 'exhibitor_document',
        entityId: documentId,
        after,
      });
      return after;
    });
    if (rejected || !result)
      throw new UnprocessableEntityException({
        message: 'The uploaded file does not match the allowed type or size.',
        code: 'UPLOAD_REJECTED',
      });
    return result;
  }

  /** An approved document stays; anything else can be replaced by deleting it first. */
  removeOwn(
    tenantId: string,
    userId: string,
    documentId: string,
  ): Promise<void> {
    return this.database.withTenant(tenantId, async (tx) => {
      const exhibitorId = await this.ownExhibitorId(tx, userId);
      const doc = await this.stored(tx, exhibitorId, documentId);
      if (doc.status === 'APPROVED')
        throw new ConflictException({
          message: 'An approved document cannot be deleted.',
          code: 'DOCUMENT_APPROVED',
        });
      await tx
        .delete(exhibitorDocuments)
        .where(eq(exhibitorDocuments.id, documentId));
      await this.storage.remove(doc.storageKey);
      await this.audit.record(tx, {
        actorId: userId,
        action: 'exhibitor_document.deleted',
        entityType: 'exhibitor_document',
        entityId: documentId,
        before: this.publicView(doc),
      });
    });
  }

  downloadOwn(
    tenantId: string,
    userId: string,
    documentId: string,
  ): Promise<DownloadTicket> {
    return this.database.withTenant(tenantId, async (tx) =>
      this.sign(
        await this.stored(
          tx,
          await this.ownExhibitorId(tx, userId),
          documentId,
          true,
        ),
      ),
    );
  }

  // ---- organizer ---------------------------------------------------------------------------

  listForExhibitor(
    tenantId: string,
    exhibitorId: string,
  ): Promise<ExhibitorDocument[]> {
    return this.database.withTenant(tenantId, async (tx) => {
      await this.requireExhibitor(tx, exhibitorId);
      return this.list(tx, exhibitorId);
    });
  }

  downloadForStaff(
    tenantId: string,
    exhibitorId: string,
    documentId: string,
  ): Promise<DownloadTicket> {
    return this.database.withTenant(tenantId, async (tx) =>
      this.sign(await this.stored(tx, exhibitorId, documentId, true)),
    );
  }

  review(
    tenantId: string,
    reviewerId: string,
    exhibitorId: string,
    documentId: string,
    input: ReviewInput,
  ): Promise<ExhibitorDocument> {
    return this.database.withTenant(tenantId, async (tx) => {
      const before = this.publicView(
        await this.stored(tx, exhibitorId, documentId, true),
      );
      await tx
        .update(exhibitorDocuments)
        .set({
          status: input.decision,
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          rejectionReason:
            input.decision === 'REJECTED' ? (input.reason ?? null) : null,
        })
        .where(eq(exhibitorDocuments.id, documentId));
      const after = await this.read(tx, eq(exhibitorDocuments.id, documentId));
      await this.audit.record(tx, {
        actorId: reviewerId,
        action: `exhibitor_document.${input.decision === 'APPROVED' ? 'approved' : 'rejected'}`,
        entityType: 'exhibitor_document',
        entityId: documentId,
        before,
        after,
      });
      return after;
    });
  }

  // ---- internals ---------------------------------------------------------------------------

  private async sign(doc: StoredDocument): Promise<DownloadTicket> {
    const url = await this.storage.presignDownload({
      key: doc.storageKey,
      fileName: doc.fileName,
      contentType: doc.contentType,
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    });
    return {
      url,
      fileName: doc.fileName,
      expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000),
    };
  }

  private list(
    tx: Transaction,
    exhibitorId: string,
  ): Promise<ExhibitorDocument[]> {
    return tx
      .select(view)
      .from(exhibitorDocuments)
      .where(
        and(
          eq(exhibitorDocuments.exhibitorId, exhibitorId),
          isNotNull(exhibitorDocuments.uploadedAt),
        ),
      )
      .orderBy(asc(exhibitorDocuments.createdAt));
  }

  private async read(tx: Transaction, where: SQL): Promise<ExhibitorDocument> {
    const [row] = await tx.select(view).from(exhibitorDocuments).where(where);
    return row;
  }

  /**
   * The row of a document of `exhibitorId`; RLS already hides other tenants. With
   * `uploadedOnly` an unconfirmed upload counts as not found (nothing to download or review).
   */
  private async stored(
    tx: Transaction,
    exhibitorId: string,
    documentId: string,
    uploadedOnly = false,
  ): Promise<StoredDocument> {
    const [row] = await tx
      .select({ ...view, storageKey: exhibitorDocuments.storageKey })
      .from(exhibitorDocuments)
      .where(
        and(
          eq(exhibitorDocuments.id, documentId),
          eq(exhibitorDocuments.exhibitorId, exhibitorId),
          uploadedOnly ? isNotNull(exhibitorDocuments.uploadedAt) : undefined,
        ),
      )
      .for('update');
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private publicView(doc: StoredDocument): ExhibitorDocument {
    const { storageKey: _storageKey, ...rest } = doc;
    return rest;
  }

  private async ownExhibitorId(
    tx: Transaction,
    userId: string,
  ): Promise<string> {
    const [row] = await tx
      .select({ id: exhibitors.id })
      .from(exhibitors)
      .where(eq(exhibitors.userId, userId));
    if (!row) throw new NotFoundException(NO_PROFILE);
    return row.id;
  }

  private async requireExhibitor(tx: Transaction, id: string): Promise<void> {
    const [row] = await tx
      .select({ id: exhibitors.id })
      .from(exhibitors)
      .where(eq(exhibitors.id, id));
    if (!row) throw new NotFoundException('Exhibitor not found.');
  }
}
