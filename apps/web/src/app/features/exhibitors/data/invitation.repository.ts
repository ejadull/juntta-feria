import type { Observable } from 'rxjs';

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

/** One row of `GET /api/v1/exhibitor-invitations` (EXH-04). The link itself is never part of it. */
export interface InvitationDto {
  readonly id: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly name: string | null;
  readonly status: InvitationStatus;
  readonly expiresAt: string;
  readonly acceptedAt: string | null;
  readonly createdAt: string;
}

/** Answer of `POST`: the one-time link, shown once and never stored by the API. */
export interface CreatedInvitationDto extends InvitationDto {
  readonly url: string;
  readonly whatsappUrl: string;
}

/** Everything is optional: a bare link is valid. With an email, only that Google account accepts. */
export interface CreateInvitationInput {
  readonly email?: string;
  readonly phone?: string;
  readonly name?: string;
  readonly expiresInDays?: number;
}

/** Port for the organizer's exhibitor invitations. Also the DI token. */
export abstract class InvitationRepository {
  abstract list(): Observable<readonly InvitationDto[]>;
  abstract create(input: CreateInvitationInput): Observable<CreatedInvitationDto>;
  abstract revoke(id: string): Observable<void>;
}
