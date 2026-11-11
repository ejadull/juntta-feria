import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { currentEvent, type OrganizerEvent } from './events.repository';
import { HttpEventsRepository } from './http-events.repository';

const event = (id: string, status: OrganizerEvent['status'], startsAt: string): OrganizerEvent => ({
  id,
  name: id,
  status,
  startsAt,
  layoutVersionId: `lv-${id}`,
});

describe('currentEvent', () => {
  it('is null without events', () => {
    expect(currentEvent([])).toBeNull();
  });

  it('prefers the most recent event on sale over newer drafts', () => {
    const events = [
      event('draft', 'DRAFT', '2027-05-01T00:00:00Z'),
      event('old', 'PUBLISHED', '2026-03-01T00:00:00Z'),
      event('new', 'ACTIVE', '2026-11-01T00:00:00Z'),
    ];
    expect(currentEvent(events)?.id).toBe('new');
  });

  it('falls back to the most recent event when none is on sale', () => {
    const events = [
      event('a', 'CLOSED', '2025-01-01T00:00:00Z'),
      event('b', 'DRAFT', '2026-01-01T00:00:00Z'),
    ];
    expect(currentEvent(events)?.id).toBe('b');
  });
});

describe('HttpEventsRepository', () => {
  it('reads GET /api/v1/events', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), HttpEventsRepository],
    });
    const result = firstValueFrom(TestBed.inject(HttpEventsRepository).list());
    const http = TestBed.inject(HttpTestingController);
    const request = http.expectOne('/api/v1/events');
    expect(request.request.method).toBe('GET');
    request.flush([event('e1', 'PUBLISHED', '2026-11-20T13:00:00Z')]);
    expect((await result)[0].id).toBe('e1');
    http.verify();
  });
});
