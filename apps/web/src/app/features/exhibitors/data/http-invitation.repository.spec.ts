import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { HttpInvitationRepository } from './http-invitation.repository';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), HttpInvitationRepository],
  });
  return {
    repo: TestBed.inject(HttpInvitationRepository),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('HttpInvitationRepository', () => {
  it('lists GET /api/v1/exhibitor-invitations', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.list());
    const request = http.expectOne('/api/v1/exhibitor-invitations');
    expect(request.request.method).toBe('GET');
    request.flush([{ id: 'i1', status: 'PENDING' }]);
    expect((await result)[0].status).toBe('PENDING');
    http.verify();
  });

  it('creates with POST and returns the one-time link', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.create({ email: 'ana@example.test', expiresInDays: 3 }));
    const request = http.expectOne('/api/v1/exhibitor-invitations');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'ana@example.test', expiresInDays: 3 });
    request.flush({
      id: 'i1',
      status: 'PENDING',
      url: 'https://app/invitacion/t',
      whatsappUrl: 'w',
    });
    expect((await result).url).toBe('https://app/invitacion/t');
    http.verify();
  });

  it('revokes with DELETE /:id', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.revoke('i 1'), { defaultValue: undefined });
    const request = http.expectOne('/api/v1/exhibitor-invitations/i%201');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await result;
    http.verify();
  });

  it('fails with the HTTP error so the panel can say what happened', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.revoke('i1'));
    http
      .expectOne('/api/v1/exhibitor-invitations/i1')
      .flush({}, { status: 409, statusText: 'Conflict' });
    await expect(result).rejects.toMatchObject({ status: 409 });
  });
});
