import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  inject,
  InjectionToken,
  input,
  signal,
} from '@angular/core';

/** `POST /reservations/{id}/checkout` (PAY-02): public data only. */
export interface CheckoutDto {
  /** `init_point`: the fallback when the Wallet Brick can't render. */
  readonly checkoutUrl: string;
  readonly preferenceId: string;
  /** Null when the API has no public key (`MP_PUBLIC_KEY`). */
  readonly wallet: { readonly publicKey: string; readonly marketplace: boolean } | null;
}

export interface WalletOptions {
  readonly publicKey: string;
  readonly preferenceId: string;
  readonly marketplace: boolean;
}

/** Mercado Pago's JS SDK v2 (Checkout Pro, "Agregar el SDK al frontend"). */
const SDK_URL = 'https://sdk.mercadopago.com/js/v2';

interface MercadoPagoSdk {
  bricks(): {
    create(brick: 'wallet', containerId: string, settings: object): Promise<unknown>;
  };
}
type MercadoPagoConstructor = new (publicKey: string, options: object) => MercadoPagoSdk;

let sdk: Promise<MercadoPagoConstructor> | undefined;

/** Loads the SDK once per page; a failed load is retried on the next call. */
function loadSdk(): Promise<MercadoPagoConstructor> {
  sdk ??= new Promise<MercadoPagoConstructor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.onload = () => {
      const MercadoPago = (window as { MercadoPago?: MercadoPagoConstructor }).MercadoPago;
      if (MercadoPago) resolve(MercadoPago);
      else reject(new Error('Mercado Pago SDK missing'));
    };
    script.onerror = () => reject(new Error('Mercado Pago SDK blocked'));
    document.body.append(script);
  }).catch((error: unknown) => {
    sdk = undefined;
    throw error;
  });
  return sdk;
}

/** Renders the Wallet Brick in a container. A token so tests never load the real SDK. */
export const MERCADO_PAGO_WALLET = new InjectionToken<
  (containerId: string, options: WalletOptions) => Promise<void>
>('MercadoPagoWallet', {
  providedIn: 'root',
  factory: () => async (containerId, { publicKey, preferenceId, marketplace }) => {
    const MercadoPago = await loadSdk();
    await new MercadoPago(publicKey, { locale: 'es-AR' })
      .bricks()
      .create('wallet', containerId, { initialization: { preferenceId, marketplace } });
  },
});

let nextId = 0;

/**
 * Checkout Pro's payment button (Wallet Brick). Without a public key, or when the SDK does not
 * load (blocked, offline), it falls back to a link to `init_point`: same checkout, plain redirect.
 */
@Component({
  selector: 'app-mercado-pago-wallet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (fallback() || !checkout().wallet) {
      <a class="btn btn-primary" [href]="checkout().checkoutUrl">Pagar con Mercado Pago</a>
    } @else {
      <div [id]="containerId" class="min-h-12"></div>
    }
  `,
})
export class MercadoPagoWallet {
  readonly checkout = input.required<CheckoutDto>();

  private readonly renderWallet = inject(MERCADO_PAGO_WALLET);
  protected readonly containerId = `wallet-${nextId++}`;
  protected readonly fallback = signal(false);

  constructor() {
    afterNextRender(() => {
      const { wallet, preferenceId } = this.checkout();
      if (!wallet) return;
      this.renderWallet(this.containerId, { ...wallet, preferenceId }).catch(() =>
        this.fallback.set(true),
      );
    });
  }
}
