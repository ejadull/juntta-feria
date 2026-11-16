import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { InMemoryPaymentAccountRepository } from './data/in-memory-payment-account.repository';
import { PaymentAccountRepository, type SellerAccountDto } from './data/payment-account.repository';
import { EXTERNAL_NAVIGATION } from '../../shared/external-navigation';
import { PaymentAccountPage } from './payment-account.page';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const LINKED: SellerAccountDto = {
  status: 'LINKED',
  environment: 'production',
  sellerId: '987654321',
  liveMode: true,
  expiresAt: '2027-05-01T12:00:00.000Z',
  linkedAt: '2026-11-02T12:00:00.000Z',
};

async function render(repo: PaymentAccountRepository = new InMemoryPaymentAccountRepository()) {
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: PaymentAccountRepository, useValue: repo },
      { provide: EXTERNAL_NAVIGATION, useValue: navigate },
    ],
  });
  const fixture = TestBed.createComponent(PaymentAccountPage);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const button = (name: string) =>
    [...host.querySelectorAll('button')].find((b) => plain(b.textContent) === name);
  const click = async (name: string) => {
    button(name)!.click();
    await fixture.whenStable();
  };
  return { fixture, host, button, click, navigate };
}

const stub = (account: SellerAccountDto): PaymentAccountRepository => {
  const repo = new InMemoryPaymentAccountRepository();
  repo.status = () => of(account);
  return repo;
};

describe('PaymentAccountPage (P12, PAY-07)', () => {
  it('shows an unlinked account with its environment and the link action', async () => {
    const { host, button } = await render();
    expect(plain(host.querySelector('h1')?.textContent)).toBe('Mercado Pago');
    const status = host.querySelector('.status')!;
    expect(plain(status.textContent)).toContain('Sin vincular');
    expect(status.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(host.textContent).toContain('Pruebas (sandbox)');
    expect(button('Vincular cuenta de Mercado Pago')).toBeTruthy();
    expect(button('Desvincular')).toBeUndefined();
  });

  it('sends the browser to the authorization URL', async () => {
    const { click, navigate } = await render();
    await click('Vincular cuenta de Mercado Pago');
    expect(navigate).toHaveBeenCalledWith(
      '/organizador/mercado-pago/vincular?code=demo-code&state=demo-state',
    );
  });

  it('shows a linked account: seller, environment and expiry, never a token', async () => {
    const { host, button } = await render(stub(LINKED));
    expect(plain(host.querySelector('.status')?.textContent)).toContain('Vinculada');
    expect(host.textContent).toContain('987654321');
    expect(host.textContent).toContain('Producción');
    expect(host.textContent).toMatch(/1\/5\/2027|01\/05\/2027/);
    expect(button('Revincular')).toBeTruthy();
    expect(button('Desvincular')).toBeTruthy();
    expect(host.textContent).not.toMatch(/APP_USR|TG-|token/i);
  });

  it('asks before unlinking, and unlinks on confirmation', async () => {
    const repo = stub(LINKED);
    const unlink = vi.spyOn(repo, 'unlink').mockReturnValue(of(undefined));
    const { host, click, button, fixture } = await render(repo);

    await click('Desvincular');
    expect(host.querySelector('dialog[open]')?.textContent).toContain('¿Desvincular');
    await click('Cancelar');
    expect(unlink).not.toHaveBeenCalled();
    expect(host.querySelector('dialog[open]')).toBeNull();

    await click('Desvincular');
    repo.status = () =>
      of({
        ...LINKED,
        status: 'NOT_LINKED',
        sellerId: null,
        expiresAt: null,
        linkedAt: null,
        liveMode: null,
      });
    await click('Sí, desvincular');
    await fixture.whenStable();
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(plain(host.querySelector('.status')?.textContent)).toContain('Sin vincular');
    expect(button('Vincular cuenta de Mercado Pago')).toBeTruthy();
  });

  it('asks to relink an expired account', async () => {
    const { host } = await render(stub({ ...LINKED, status: 'EXPIRED' }));
    expect(plain(host.querySelector('.status')?.textContent)).toContain('Vencida');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Revinculá');
  });

  it('reports a failure to load or to start the link', async () => {
    const broken = new InMemoryPaymentAccountRepository();
    broken.status = () => throwError(() => new Error('boom'));
    const failed = await render(broken);
    expect(failed.host.querySelector('[role="alert"]')?.textContent).toContain('No pudimos');
    TestBed.resetTestingModule();

    const repo = new InMemoryPaymentAccountRepository();
    repo.startLink = () => throwError(() => new Error('boom'));
    const { host, click, navigate } = await render(repo);
    await click('Vincular cuenta de Mercado Pago');
    expect(navigate).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No pudimos');
  });
});
