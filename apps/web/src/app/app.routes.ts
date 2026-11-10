import { Routes } from '@angular/router';
import { EventMetricsRepository } from './features/dashboard/data/event-metrics.repository';
import { InMemoryEventMetricsRepository } from './features/dashboard/data/in-memory-event-metrics.repository';
import { ExhibitorRepository } from './features/exhibitors/data/exhibitor.repository';
import { InMemoryExhibitorRepository } from './features/exhibitors/data/in-memory-exhibitor.repository';
import { InMemoryLayoutRepository } from './features/layout-editor/data/in-memory-layout.repository';
import { LayoutRepository } from './features/layout-editor/data/layout.repository';
import { InMemoryPaymentAccountRepository } from './features/payment-account/data/in-memory-payment-account.repository';
import { PaymentAccountRepository } from './features/payment-account/data/payment-account.repository';
import { HttpTenantCatalogRepository } from './features/public-catalog/data/http-tenant-catalog.repository';
import { InMemoryPublicCatalogRepository } from './features/public-catalog/data/in-memory-public-catalog.repository';
import { PublicCatalogRepository } from './features/public-catalog/data/public-catalog.repository';
import { HttpReservationPaymentRepository } from './features/checkout-return/data/http-reservation-payment.repository';
import { ReservationPaymentRepository } from './features/checkout-return/data/reservation-payment.repository';
import { APP_NAME } from './shared/demo-context';
import { authGuard } from './shared/auth/auth.guard';

const title = (section: string): string => `${section} · ${APP_NAME}`;
const notFound = () => import('./features/not-found.page').then((m) => m.NotFoundPage);
const reservationsPlaceholder = () =>
  import('./features/reservations/reservations-placeholder.page').then(
    (m) => m.ReservationsPlaceholderPage,
  );
const login = () => import('./features/auth/login.page').then((m) => m.LoginPage);
const explore = () =>
  import('./features/public-catalog/explore-stands.page').then((m) => m.ExploreStandsPage);
const publicCatalog = [
  { provide: PublicCatalogRepository, useFactory: () => new InMemoryPublicCatalogRepository() },
];
// The exhibitor area talks to the real API (stands of the exhibitor's organization, reservations).
const feriante = [
  { provide: PublicCatalogRepository, useClass: HttpTenantCatalogRepository },
  { provide: ReservationPaymentRepository, useClass: HttpReservationPaymentRepository },
];
/** P19 (PAY-04): one route per Mercado Pago `back_urls` entry (checkout.service.ts). */
const checkoutReturns = (
  [
    ['aprobado', 'approved'],
    ['pendiente', 'pending'],
    ['rechazado', 'rejected'],
  ] as const
).map(([path, outcome]) => ({
  path: `reservas/:id/pago/${path}`,
  title: title('Pago de tu reserva'),
  data: { outcome },
  loadComponent: () =>
    import('./features/checkout-return/checkout-return.page').then((m) => m.CheckoutReturnPage),
}));

// ponytail: the organizer screens and the visitor portal still use in-memory adapters until their
// APIs are wired (REP-01, EXH-01, PUB-01); swap each `useFactory` for its Http adapter here.
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'organizador/panel' },
  {
    path: '',
    loadComponent: () => import('./features/shell/app-shell').then((m) => m.AppShell),
    children: [
      {
        path: 'organizador',
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'panel' },
          {
            path: 'panel',
            title: title('Panel'),
            loadComponent: () =>
              import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
            providers: [
              {
                provide: EventMetricsRepository,
                useFactory: () => new InMemoryEventMetricsRepository(),
              },
            ],
          },
          {
            path: 'layouts/:versionId/editor',
            title: title('Editor de plano'),
            loadComponent: () =>
              import('./features/layout-editor/layout-editor.page').then((m) => m.LayoutEditorPage),
            providers: [
              { provide: LayoutRepository, useFactory: () => new InMemoryLayoutRepository() },
            ],
          },
          {
            path: 'reservas',
            title: title('Reservas y cobros'),
            loadComponent: reservationsPlaceholder,
            data: {
              eyebrow: 'ORGANIZADOR',
              heading: 'Reservas y cobros',
              intro:
                'Va a mostrar las reservas del evento por estado (retenidas, pendientes de pago, confirmadas, vencidas), la conciliación con Mercado Pago, los pagos tardíos y los reembolsos.',
              backLink: '/organizador/panel',
              backLabel: 'Volver al panel',
            },
          },
          {
            path: 'expositores',
            title: title('Expositores'),
            loadComponent: () =>
              import('./features/exhibitors/exhibitors.page').then((m) => m.ExhibitorsPage),
            providers: [
              {
                provide: ExhibitorRepository,
                useFactory: () => new InMemoryExhibitorRepository(),
              },
            ],
          },
          {
            path: 'mercado-pago',
            // One repository for both pages: the return page links, P12 shows the result.
            providers: [
              {
                provide: PaymentAccountRepository,
                useFactory: () => new InMemoryPaymentAccountRepository(),
              },
            ],
            children: [
              {
                path: '',
                pathMatch: 'full',
                title: title('Mercado Pago'),
                loadComponent: () =>
                  import('./features/payment-account/payment-account.page').then(
                    (m) => m.PaymentAccountPage,
                  ),
              },
              {
                // MP_OAUTH_REDIRECT_URI points here (PAY-07).
                path: 'vincular',
                title: title('Vincular Mercado Pago'),
                loadComponent: () =>
                  import('./features/payment-account/payment-account-return.page').then(
                    (m) => m.PaymentAccountReturnPage,
                  ),
              },
            ],
          },
          { path: '**', title: title('Página no encontrada'), loadComponent: notFound },
        ],
      },
      { path: 'ingresar', title: title('Ingresar'), loadComponent: login },
      {
        // The link EXH-04 invitations carry: `<web>/invitacion/<token>`.
        path: 'invitacion/:token',
        title: title('Tu invitación'),
        loadComponent: () =>
          import('./features/invitation/invitation.page').then((m) => m.InvitationPage),
      },
      {
        path: 'feriante',
        providers: feriante,
        canActivate: [authGuard],
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'explorar' },
          { path: 'explorar', title: title('Explorar stands'), loadComponent: explore },
          { path: 'explorar/:slug', title: title('Explorar stands'), loadComponent: explore },
          {
            path: 'reservas/nueva',
            title: title('Reserva y pago'),
            loadComponent: () =>
              import('./features/reservations/reserve.page').then((m) => m.ReservePage),
          },
          {
            path: 'reservas',
            pathMatch: 'full',
            title: title('Mis reservas'),
            loadComponent: () =>
              import('./features/reservations/my-reservations.page').then(
                (m) => m.MyReservationsPage,
              ),
          },
          {
            path: 'suscripcion',
            title: title('Suscripción'),
            loadComponent: () =>
              import('./features/subscription/subscription.page').then((m) => m.SubscriptionPage),
          },
          ...checkoutReturns,
          { path: '**', title: title('Página no encontrada'), loadComponent: notFound },
        ],
      },
      {
        path: 'ferias',
        providers: publicCatalog,
        children: [
          {
            path: '',
            pathMatch: 'full',
            title: title('Ferias'),
            loadComponent: () =>
              import('./features/public-catalog/fairs.page').then((m) => m.FairsPage),
          },
          {
            path: ':slug',
            title: title('Mapa y expositores'),
            loadComponent: () =>
              import('./features/public-catalog/fair-map.page').then((m) => m.FairMapPage),
          },
        ],
      },
    ],
  },
  { path: '**', title: title('Página no encontrada'), loadComponent: notFound },
];
