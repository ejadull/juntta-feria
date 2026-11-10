import { InjectionToken } from '@angular/core';

/** Leaves the app for a provider page (Mercado Pago). A token so tests never navigate. */
export const EXTERNAL_NAVIGATION = new InjectionToken<(url: string) => void>('ExternalNavigation', {
  providedIn: 'root',
  factory: () => (url: string) => window.location.assign(url),
});
