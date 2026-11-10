import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { InMemoryPaymentAccountRepository } from './data/in-memory-payment-account.repository';
import { PaymentAccountRepository } from './data/payment-account.repository';
import { PaymentAccountReturnPage } from './payment-account-return.page';

async function render(query: { code?: string; state?: string; error?: string }) {
  const repo = new InMemoryPaymentAccountRepository();
  const complete = vi.spyOn(repo, 'completeLink');
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: PaymentAccountRepository, useValue: repo }],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  const fixture = TestBed.createComponent(PaymentAccountReturnPage);
  for (const [key, value] of Object.entries(query)) fixture.componentRef.setInput(key, value);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  return { host, complete, navigate, repo };
}

describe('PaymentAccountReturnPage (P12 redirect, PAY-07)', () => {
  it('completes the link with the code and state and returns to P12', async () => {
    const { complete, navigate } = await render({ code: 'demo-code', state: 'demo-state' });
    expect(complete).toHaveBeenCalledWith('demo-code', 'demo-state');
    expect(navigate).toHaveBeenCalledWith('/organizador/mercado-pago');
  });

  it('explains an invalid or expired authorization and offers to retry', async () => {
    const { host, navigate } = await render({ code: 'x', state: 'forged' });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('no es válida o venció');
    expect(host.querySelector('a[href="/organizador/mercado-pago"]')).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not call the API when the organizer cancelled on Mercado Pago', async () => {
    const { host, complete } = await render({ error: 'access_denied' });
    expect(complete).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Cancelaste');
  });

  it('treats a return without code as invalid', async () => {
    const { host, complete } = await render({ state: 'demo-state' });
    expect(complete).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('no es válida o venció');
  });
});
