import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HttpPaymentAccountRepository } from './http-payment-account.repository';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), HttpPaymentAccountRepository],
  });
  return {
    repo: TestBed.inject(HttpPaymentAccountRepository),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('HttpPaymentAccountRepository (PAY-07)', () => {
  it('reads the account', () => {
    const { repo, http } = setup();
    let status = '';
    repo.status().subscribe((a) => (status = a.status));
    const req = http.expectOne('/api/v1/payment-account');
    expect(req.request.method).toBe('GET');
    req.flush({ status: 'NOT_LINKED' });
    expect(status).toBe('NOT_LINKED');
  });

  it('starts the link and returns the authorization URL', () => {
    const { repo, http } = setup();
    let url = '';
    repo.startLink().subscribe((u) => (url = u));
    const req = http.expectOne('/api/v1/payment-account/authorization');
    expect(req.request.method).toBe('POST');
    req.flush({ authorizationUrl: 'https://auth.mercadopago.test/authorization?x=1' });
    expect(url).toBe('https://auth.mercadopago.test/authorization?x=1');
  });

  it('completes the link with the code and the state of the return', () => {
    const { repo, http } = setup();
    repo.completeLink('c', 's').subscribe();
    const req = http.expectOne('/api/v1/payment-account/link');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ code: 'c', state: 's' });
    req.flush({ status: 'LINKED' });
  });

  it('turns a problem code into the error message, as the port promises', () => {
    const { repo, http } = setup();
    let message = '';
    repo.completeLink('c', 'forged').subscribe({ error: (e: Error) => (message = e.message) });
    http
      .expectOne('/api/v1/payment-account/link')
      .flush({ code: 'INVALID_OAUTH_STATE' }, { status: 400, statusText: 'Bad Request' });
    expect(message).toBe('INVALID_OAUTH_STATE');
  });

  it('unlinks the account', () => {
    const { repo, http } = setup();
    repo.unlink().subscribe();
    const req = http.expectOne('/api/v1/payment-account');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });
});
