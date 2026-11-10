import { TestBed } from '@angular/core/testing';
import { MERCADO_PAGO_WALLET, MercadoPagoWallet, type CheckoutDto } from './mercado-pago-wallet';

const CHECKOUT: CheckoutDto = {
  checkoutUrl: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1',
  preferenceId: 'pref-1',
  wallet: { publicKey: 'TEST-pk', marketplace: true },
};

async function render(checkout: CheckoutDto, renderWallet = vi.fn(async () => undefined)) {
  TestBed.configureTestingModule({
    providers: [{ provide: MERCADO_PAGO_WALLET, useValue: renderWallet }],
  });
  const fixture = TestBed.createComponent(MercadoPagoWallet);
  fixture.componentRef.setInput('checkout', checkout);
  await fixture.whenStable();
  await vi.waitFor(() => expect(renderWallet).toHaveBeenCalledTimes(checkout.wallet ? 1 : 0));
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  return { host, renderWallet, link: () => host.querySelector('a') };
}

describe('MercadoPagoWallet (Checkout Pro: Wallet Brick)', () => {
  it('renders the Wallet Brick with the preference, in marketplace mode', async () => {
    const { host, renderWallet, link } = await render(CHECKOUT);
    const container = host.querySelector('[id^="wallet-"]')!;
    expect(renderWallet).toHaveBeenCalledWith(container.id, {
      publicKey: 'TEST-pk',
      preferenceId: 'pref-1',
      marketplace: true,
    });
    expect(link()).toBeNull();
  });

  it('falls back to the init_point link without a public key', async () => {
    const { link } = await render({ ...CHECKOUT, wallet: null });
    expect(link()?.getAttribute('href')).toBe(CHECKOUT.checkoutUrl);
    expect(link()?.textContent).toContain('Pagar con Mercado Pago');
  });

  it('falls back to the init_point link when the SDK does not load', async () => {
    const { link } = await render(
      CHECKOUT,
      vi.fn(async () => {
        throw new Error('blocked');
      }),
    );
    await vi.waitFor(() => expect(link()?.getAttribute('href')).toBe(CHECKOUT.checkoutUrl));
  });
});
