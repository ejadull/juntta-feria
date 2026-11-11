import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { EventMetricsRepository } from './features/dashboard/data/event-metrics.repository';
import { HttpReservationsExportRepository } from './features/reports/data/http-reservations-export.repository';
import { ReservationsExportRepository } from './features/reports/data/reservations-export.repository';
import { HttpEventMetricsRepository } from './features/dashboard/data/http-event-metrics.repository';
import {
  DocumentReviewRepository,
  FileUploader,
  OwnDocumentsRepository,
} from './features/documents/data/document.repository';
import {
  HttpDocumentReviewRepository,
  HttpFileUploader,
  HttpOwnDocumentsRepository,
} from './features/documents/data/http-documents.repository';
import { ExhibitorProfileRepository } from './features/exhibitor-profile/data/exhibitor-profile.repository';
import { HttpExhibitorProfileRepository } from './features/exhibitor-profile/data/http-exhibitor-profile.repository';
import { CategoryRepository } from './features/exhibitors/data/category.repository';
import { HttpCategoryRepository } from './features/exhibitors/data/http-category.repository';
import { ExhibitorRepository } from './features/exhibitors/data/exhibitor.repository';
import { HttpExhibitorRepository } from './features/exhibitors/data/http-exhibitor.repository';
import { HttpInvitationRepository } from './features/exhibitors/data/http-invitation.repository';
import { InvitationRepository } from './features/exhibitors/data/invitation.repository';
import { EventAdminRepository } from './features/events/data/event-admin.repository';
import { EventInventoryRepository } from './features/events/data/event-inventory.repository';
import { HttpEventAdminRepository } from './features/events/data/http-event-admin.repository';
import { HttpEventInventoryRepository } from './features/events/data/http-event-inventory.repository';
import { HttpLayoutTemplatesRepository } from './features/layout-editor/data/http-layout-templates.repository';
import { LayoutTemplatesRepository } from './features/layout-editor/data/layout-templates.repository';
import { HttpVenueRepository } from './features/venues/data/http-venue.repository';
import { VenueRepository } from './features/venues/data/venue.repository';
import { HttpLayoutRepository } from './features/layout-editor/data/http-layout.repository';
import { LayoutRepository } from './features/layout-editor/data/layout.repository';
import { HttpPaymentAccountRepository } from './features/payment-account/data/http-payment-account.repository';
import { PaymentAccountRepository } from './features/payment-account/data/payment-account.repository';
import { HttpOrganizerReservationsRepository } from './features/organizer-reservations/data/http-organizer-reservations.repository';
import { OrganizerReservationsRepository } from './features/organizer-reservations/data/organizer-reservations.repository';
import { HttpTenantCatalogRepository } from './features/public-catalog/data/http-tenant-catalog.repository';
import { HttpPublicCatalogRepository } from './features/public-catalog/data/http-public-catalog.repository';
import { PublicCatalogRepository } from './features/public-catalog/data/public-catalog.repository';
import { HttpReservationPaymentRepository } from './features/checkout-return/data/http-reservation-payment.repository';
import { ReservationPaymentRepository } from './features/checkout-return/data/reservation-payment.repository';
import { APP_NAME } from './shared/demo-context';
import { EventsRepository } from './shared/events/events.repository';
import { HttpEventsRepository } from './shared/events/http-events.repository';
import { AREA_HOME } from './shared/auth/area';
import { areaGuard } from './shared/auth/auth.guard';
import { SessionStore } from './shared/auth/session.store';

const title = (section: string): string => `${section} · ${APP_NAME}`;
const notFound = () => import('./features/not-found.page').then((m) => m.NotFoundPage);
const login = () => import('./features/auth/login.page').then((m) => m.LoginPage);
const explore = () =>
  import('./features/public-catalog/explore-stands.page').then((m) => m.ExploreStandsPage);
// The visitor portal reads the public API anonymously (no session, no tenant).
const publicCatalog = [{ provide: PublicCatalogRepository, useClass: HttpPublicCatalogRepository }];
// The exhibitor area talks to the real API (stands of the exhibitor's organization, reservations).
const feriante = [
  { provide: PublicCatalogRepository, useClass: HttpTenantCatalogRepository },
  { provide: ReservationPaymentRepository, useClass: HttpReservationPaymentRepository },
  // Own profile (rubro picked from the organization's list) and own documents (EXH-01..03).
  { provide: ExhibitorProfileRepository, useClass: HttpExhibitorProfileRepository },
  { provide: CategoryRepository, useClass: HttpCategoryRepository },
  { provide: OwnDocumentsRepository, useClass: HttpOwnDocumentsRepository },
  { provide: FileUploader, useClass: HttpFileUploader },
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

export const routes: Routes = [
  // Each role lands on its own home; anonymous users on the public fairs.
  { path: '', pathMatch: 'full', redirectTo: () => AREA_HOME[inject(SessionStore).area()] },
  {
    path: '',
    loadComponent: () => import('./features/shell/app-shell').then((m) => m.AppShell),
    children: [
      {
        path: 'organizador',
        canActivate: [areaGuard('organizador')],
        // The current event (Panel, Editor de plano) comes from the API.
        providers: [
          { provide: EventsRepository, useClass: HttpEventsRepository },
          // Setup: venues, plans and events are created and read from several organizer pages.
          { provide: VenueRepository, useClass: HttpVenueRepository },
          { provide: LayoutTemplatesRepository, useClass: HttpLayoutTemplatesRepository },
          { provide: EventAdminRepository, useClass: HttpEventAdminRepository },
        ],
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'panel' },
          {
            path: 'panel',
            title: title('Panel'),
            loadComponent: () =>
              import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
            providers: [
              { provide: EventMetricsRepository, useClass: HttpEventMetricsRepository },
              { provide: ReservationsExportRepository, useClass: HttpReservationsExportRepository },
              // The "Primeros pasos" checklist asks whether Mercado Pago is linked.
              { provide: PaymentAccountRepository, useClass: HttpPaymentAccountRepository },
            ],
          },
          {
            path: 'eventos',
            children: [
              {
                path: '',
                pathMatch: 'full',
                title: title('Eventos'),
                loadComponent: () =>
                  import('./features/events/events.page').then((m) => m.EventsPage),
              },
              {
                path: ':id',
                title: title('Evento'),
                loadComponent: () =>
                  import('./features/events/event-detail.page').then((m) => m.EventDetailPage),
                providers: [
                  { provide: EventInventoryRepository, useClass: HttpEventInventoryRepository },
                  // Only to read the event plan (stand areas).
                  { provide: LayoutRepository, useClass: HttpLayoutRepository },
                ],
              },
            ],
          },
          {
            path: 'predios',
            title: title('Predios'),
            loadComponent: () => import('./features/venues/venues.page').then((m) => m.VenuesPage),
          },
          {
            path: 'plano',
            title: title('Editor de plano'),
            loadComponent: () =>
              import('./features/layout-editor/layout-entry.page').then((m) => m.LayoutEntryPage),
          },
          {
            path: 'layouts/:versionId/editor',
            title: title('Editor de plano'),
            loadComponent: () =>
              import('./features/layout-editor/layout-editor.page').then((m) => m.LayoutEditorPage),
            providers: [{ provide: LayoutRepository, useClass: HttpLayoutRepository }],
          },
          {
            path: 'reservas',
            title: title('Reservas y cobros'),
            loadComponent: () =>
              import('./features/organizer-reservations/organizer-reservations.page').then(
                (m) => m.OrganizerReservationsPage,
              ),
            providers: [
              {
                provide: OrganizerReservationsRepository,
                useClass: HttpOrganizerReservationsRepository,
              },
              { provide: ReservationsExportRepository, useClass: HttpReservationsExportRepository },
            ],
          },
          {
            path: 'expositores',
            title: title('Expositores'),
            loadComponent: () =>
              import('./features/exhibitors/exhibitors.page').then((m) => m.ExhibitorsPage),
            providers: [
              { provide: ExhibitorRepository, useClass: HttpExhibitorRepository },
              { provide: InvitationRepository, useClass: HttpInvitationRepository },
              { provide: CategoryRepository, useClass: HttpCategoryRepository },
              { provide: DocumentReviewRepository, useClass: HttpDocumentReviewRepository },
            ],
          },
          {
            path: 'mercado-pago',
            // One repository for both pages: the return page links, P12 shows the result.
            providers: [
              { provide: PaymentAccountRepository, useClass: HttpPaymentAccountRepository },
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
        canActivate: [areaGuard('feriante')],
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
            path: 'perfil',
            title: title('Mi perfil'),
            loadComponent: () =>
              import('./features/exhibitor-profile/exhibitor-profile.page').then(
                (m) => m.ExhibitorProfilePage,
              ),
          },
          {
            path: 'documentos',
            title: title('Mis documentos'),
            loadComponent: () =>
              import('./features/documents/my-documents.page').then((m) => m.MyDocumentsPage),
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
