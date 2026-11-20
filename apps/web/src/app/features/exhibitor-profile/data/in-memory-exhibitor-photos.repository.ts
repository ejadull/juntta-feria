import { defer, of, throwError, type Observable } from 'rxjs';
import {
  ExhibitorPhotosRepository,
  type ExhibitorEventOption,
  type ExhibitorPhotoDto,
  type PhotoUploadRequest,
  type PhotoUploadTicketDto,
} from './exhibitor-photos.repository';

/** Test double: keeps media in memory; `complete` confirms what `requestUpload` registered. */
export class InMemoryExhibitorPhotosRepository extends ExhibitorPhotosRepository {
  private rows: readonly ExhibitorPhotoDto[];
  private pending: readonly ExhibitorPhotoDto[] = [];
  private next = 1;

  constructor(
    seed: readonly ExhibitorPhotoDto[] = [],
    private readonly events: readonly ExhibitorEventOption[] = [],
  ) {
    super();
    this.rows = seed;
  }

  all(): readonly ExhibitorPhotoDto[] {
    return this.rows;
  }

  list(): Observable<readonly ExhibitorPhotoDto[]> {
    return defer(() => of(this.rows));
  }

  myEvents(): Observable<readonly ExhibitorEventOption[]> {
    return defer(() => of(this.events));
  }

  requestUpload(request: PhotoUploadRequest): Observable<PhotoUploadTicketDto> {
    return defer(() => {
      const id = `photo-${this.next++}`;
      const photo: ExhibitorPhotoDto = {
        id,
        status: 'PENDING',
        kind: request.contentType.startsWith('video/') ? 'VIDEO' : 'IMAGE',
        contentType: request.contentType,
        sizeBytes: request.sizeBytes,
        alt: request.alt ?? null,
        caption: request.caption ?? null,
        durationS: request.durationS ?? null,
        eventId: request.eventId ?? null,
        position: this.rows.length + this.pending.length,
        url: `https://files.test/${id}`,
      };
      this.pending = [...this.pending, photo];
      const { url: _url, ...rest } = photo;
      return of({
        photo: rest,
        upload: {
          url: `https://files.test/upload/${id}`,
          method: 'PUT' as const,
          headers: { 'Content-Type': request.contentType },
          expiresAt: '2026-11-10T12:15:00Z',
        },
      });
    });
  }

  complete(id: string): Observable<ExhibitorPhotoDto> {
    return defer(() => {
      const found = this.pending.find((p) => p.id === id);
      if (!found) throw new Error(`Unknown photo ${id}`);
      const ready: ExhibitorPhotoDto = { ...found, status: 'READY' };
      this.pending = this.pending.filter((p) => p.id !== id);
      this.rows = [...this.rows, ready];
      return of(ready);
    });
  }

  remove(id: string): Observable<void> {
    return defer(() => {
      this.rows = this.rows.filter((p) => p.id !== id);
      return of(undefined);
    });
  }

  updateCaption(id: string, caption: string): Observable<ExhibitorPhotoDto> {
    return defer(() => {
      const found = this.rows.find((p) => p.id === id);
      if (!found) return throwError(() => new Error(`Unknown photo ${id}`));
      const updated: ExhibitorPhotoDto = { ...found, caption };
      this.rows = this.rows.map((p) => (p.id === id ? updated : p));
      return of(updated);
    });
  }
}
