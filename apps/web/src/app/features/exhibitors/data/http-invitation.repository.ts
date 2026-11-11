import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
import {
  InvitationRepository,
  type CreatedInvitationDto,
  type CreateInvitationInput,
  type InvitationDto,
} from './invitation.repository';

/** Exhibitor invitations through the API (OWNER, ADMIN and OPERATOR). */
@Injectable()
export class HttpInvitationRepository extends InvitationRepository {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE}/exhibitor-invitations`;

  list(): Observable<readonly InvitationDto[]> {
    return this.http.get<readonly InvitationDto[]>(this.url);
  }

  create(input: CreateInvitationInput): Observable<CreatedInvitationDto> {
    return this.http.post<CreatedInvitationDto>(this.url, input);
  }

  revoke(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${encodeURIComponent(id)}`);
  }
}
