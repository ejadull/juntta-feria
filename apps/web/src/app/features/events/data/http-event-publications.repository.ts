import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
import {
  EventPublicationsRepository,
  type EventPublicationDto,
} from './event-publications.repository';

/** The organizer's moderation of publications through the API (`/events/:id/publications`). */
@Injectable()
export class HttpEventPublicationsRepository extends EventPublicationsRepository {
  private readonly http = inject(HttpClient);

  private publications(eventId: string): string {
    return `${API_BASE}/events/${encodeURIComponent(eventId)}/publications`;
  }

  list(eventId: string): Observable<readonly EventPublicationDto[]> {
    return this.http.get<readonly EventPublicationDto[]>(this.publications(eventId));
  }

  setHidden(eventId: string, id: string, hidden: boolean): Observable<EventPublicationDto> {
    return this.http.patch<EventPublicationDto>(
      `${this.publications(eventId)}/${encodeURIComponent(id)}`,
      { hidden },
    );
  }
}
