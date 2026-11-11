import type { Observable } from 'rxjs';

/** Worst `documents.review_status` of the exhibitor; MISSING when there are no documents. */
export type DocumentsStatus = 'MISSING' | 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * Organizer read model of `GET /api/v1/exhibitors` (design D4).
 * Contains private data (tax id): never reuse it for public views (INV-08).
 */
export interface ExhibitorSummaryDto {
  readonly id: string;
  readonly tradeName: string;
  readonly legalName: string;
  readonly taxId: string | null;
  /** Null while the exhibitor has not picked one of the organization's rubros (EXH-02). */
  readonly categoryId: string | null;
  readonly category: string | null;
  readonly description: string;
  readonly publicContactOptIn: boolean;
  readonly documentsStatus: DocumentsStatus;
}

/** Port for the organizer's exhibitor list. Also the DI token. */
export abstract class ExhibitorRepository {
  abstract list(): Observable<readonly ExhibitorSummaryDto[]>;
}
