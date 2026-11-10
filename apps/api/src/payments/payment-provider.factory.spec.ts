import { MercadoPagoOrdersProvider } from './mercadopago-orders.provider.js';
import { MercadoPagoPreferencesProvider } from './mercadopago-preferences.provider.js';
import { createPaymentProvider } from './payment-provider.factory.js';
import type { AppConfiguration } from '../config/configuration.js';

const settings = (
  checkoutApi: 'preferences' | 'orders',
): AppConfiguration['mercadoPago'] => ({
  environment: 'sandbox',
  accessToken: 'TEST-fake',
  webhookSecret: undefined,
  notificationUrl: undefined,
  clientId: undefined,
  clientSecret: undefined,
  oauthRedirectUri: undefined,
  tokenKey: undefined,
  publicKey: undefined,
  subscriptionPriceCents: undefined,
  checkoutApi,
});

describe('createPaymentProvider (MP_CHECKOUT_API)', () => {
  const none = () => Promise.resolve(null);

  it('builds the Preferences adapter for preferences', () => {
    expect(createPaymentProvider(settings('preferences'), none)).toBeInstanceOf(
      MercadoPagoPreferencesProvider,
    );
  });

  it('builds the Orders adapter for orders', () => {
    expect(createPaymentProvider(settings('orders'), none)).toBeInstanceOf(
      MercadoPagoOrdersProvider,
    );
  });
});
