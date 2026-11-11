import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
import {
  EventInventoryRepository,
  type SectorDto,
  type SectorInput,
  type StandChange,
  type StandDto,
} from './event-inventory.repository';

/** EVT-01 sectors and stands through the API (tenant and token come from the interceptor). */
@Injectable()
export class HttpEventInventoryRepository extends EventInventoryRepository {
  private readonly http = inject(HttpClient);

  listSectors(eventId: string): Observable<readonly SectorDto[]> {
    return this.http.get<readonly SectorDto[]>(this.sectors(eventId));
  }

  createSector(eventId: string, input: SectorInput): Observable<SectorDto> {
    return this.http.post<SectorDto>(this.sectors(eventId), input);
  }

  updateSector(
    eventId: string,
    sectorId: string,
    patch: Partial<SectorInput>,
  ): Observable<SectorDto> {
    const url = `${this.sectors(eventId)}/${encodeURIComponent(sectorId)}`;
    return this.http.patch<SectorDto>(url, patch);
  }

  removeSector(eventId: string, sectorId: string): Observable<void> {
    return this.http.delete<void>(`${this.sectors(eventId)}/${encodeURIComponent(sectorId)}`);
  }

  listStands(eventId: string): Observable<readonly StandDto[]> {
    return this.http.get<readonly StandDto[]>(this.stands(eventId));
  }

  updateStands(eventId: string, change: StandChange): Observable<readonly StandDto[]> {
    return this.http.patch<readonly StandDto[]>(this.stands(eventId), change);
  }

  private sectors(eventId: string): string {
    return `${API_BASE}/events/${encodeURIComponent(eventId)}/sectors`;
  }

  private stands(eventId: string): string {
    return `${API_BASE}/events/${encodeURIComponent(eventId)}/stands`;
  }
}
