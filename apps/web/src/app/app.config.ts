import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withPreloading,
  withViewTransitions,
} from '@angular/router';
import { routes } from './app.routes';
import { authInterceptor } from './shared/auth/auth.interceptor';
import { SessionStore } from './shared/auth/session.store';
import { HoverPreloading } from './shared/hover-preloading';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Hovering or focusing a link downloads that page's code ahead of the click.
    // Page changes crossfade (styles.css, disabled under prefers-reduced-motion); not on first load.
    provideRouter(
      routes,
      withComponentInputBinding(),
      withPreloading(HoverPreloading),
      withViewTransitions({ skipInitialTransition: true }),
    ),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    // Picks up a previous session (HttpOnly refresh cookie) before the first navigation.
    provideAppInitializer(() => inject(SessionStore).restore()),
  ],
};
