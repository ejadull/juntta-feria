import type { AppConfiguration } from '../config/configuration.js';
import { MercadoPagoOrdersProvider } from './mercadopago-orders.provider.js';
import { MercadoPagoPreferencesProvider } from './mercadopago-preferences.provider.js';
import type { PaymentProvider } from './payment-provider.js';

/** Picks the Checkout Pro integration with `MP_CHECKOUT_API` (ADR 0007, amended 2026-11-10). */
export const createPaymentProvider = (
  settings: AppConfiguration['mercadoPago'],
  sellerToken: (tenantId: string) => Promise<string | null>,
): PaymentProvider =>
  settings.checkoutApi === 'orders'
    ? new MercadoPagoOrdersProvider(settings, sellerToken)
    : new MercadoPagoPreferencesProvider(settings, sellerToken);
