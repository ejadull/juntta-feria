import { defer, of, throwError, type Observable } from 'rxjs';
import {
  InvitationRepository,
  type CreatedInvitationDto,
  type CreateInvitationInput,
  type InvitationDto,
} from './invitation.repository';

const DAY_MS = 86_400_000;

/** Test double with the API's rules: only a pending invitation can be revoked. */
export class InMemoryInvitationRepository extends InvitationRepository {
  private rows: InvitationDto[];
  private next = 1;

  constructor(seed: readonly InvitationDto[] = []) {
    super();
    this.rows = [...seed];
  }

  list(): Observable<readonly InvitationDto[]> {
    return defer(() => of([...this.rows]));
  }

  create(input: CreateInvitationInput): Observable<CreatedInvitationDto> {
    return defer(() => {
      const now = Date.now();
      const row: InvitationDto = {
        id: `inv-${this.next++}`,
        email: input.email ?? null,
        phone: input.phone ?? null,
        name: input.name ?? null,
        status: 'PENDING',
        expiresAt: new Date(now + (input.expiresInDays ?? 7) * DAY_MS).toISOString(),
        acceptedAt: null,
        createdAt: new Date(now).toISOString(),
      };
      this.rows = [row, ...this.rows];
      const url = `https://feria.test/invitacion/token-${row.id}`;
      const text = encodeURIComponent(`Sumate como feriante: ${url}`);
      return of({ ...row, url, whatsappUrl: `https://wa.me/${row.phone ?? ''}?text=${text}` });
    });
  }

  revoke(id: string): Observable<void> {
    return defer(() => {
      const row = this.rows.find((r) => r.id === id);
      if (!row) return throwError(() => ({ status: 404 }));
      if (row.status !== 'PENDING') return throwError(() => ({ status: 409 }));
      this.rows = this.rows.map((r) => (r.id === id ? { ...r, status: 'REVOKED' as const } : r));
      return of(undefined);
    });
  }
}
