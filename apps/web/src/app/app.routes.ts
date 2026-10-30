import { Routes } from '@angular/router';
import { EventMetricsRepository } from './features/dashboard/data/event-metrics.repository';
import { InMemoryEventMetricsRepository } from './features/dashboard/data/in-memory-event-metrics.repository';
import { ExhibitorRepository } from './features/exhibitors/data/exhibitor.repository';
import { InMemoryExhibitorRepository } from './features/exhibitors/data/in-memory-exhibitor.repository';
import { InMemoryLayoutRepository } from './features/layout-editor/data/in-memory-layout.repository';
import { LayoutRepository } from './features/layout-editor/data/layout.repository';
import { InMemoryPublicCatalogRepository } from './features/public-catalog/data/in-memory-public-catalog.repository';
import { PublicCatalogRepository } from './features/public-catalog/data/public-catalog.repository';
import { APP_NAME } from './shared/demo-context';

const title = (section: string): string => `${section} · ${APP_NAME}`;
const notFound = () => import('./features/not-found.page').then((m) => m.NotFoundPage);
const reservationsPlaceholder = () =>
  import('./features/reservations/reservations-placeholder.page').then(
    (m) => m.ReservationsPlaceholderPage,
  );
const publicCatalog = [
  { provide: PublicCatalogRepository, useFactory: () => new InMemoryPublicCatalogRepository() },
];
const FERIANTE_BACK = {
  eyebrow: 'FERIANTE',
  backLink: '/feriante/explorar',
  backLabel: 'Volver a explorar stands',
};

// ponytail: in-memory adapters are provided per route until the API exists (LAY-01, REP-01, EXH-01,
// PUB-01); swap each `useFactory` for its Http adapter here, without touching components.
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
          { path: '**', title: title('Página no encontrada'), loadComponent: notFound },
        ],
      },
      {
        path: 'feriante',
        providers: publicCatalog,
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'explorar' },
          {
            path: 'explorar',
            title: title('Explorar stands'),
            loadComponent: () =>
              import('./features/public-catalog/explore-stands.page').then(
                (m) => m.ExploreStandsPage,
              ),
          },
          {
            path: 'reserva',
            title: title('Reserva y pago'),
            loadComponent: reservationsPlaceholder,
            data: {
              ...FERIANTE_BACK,
              heading: 'Reserva y pago',
              intro:
                'Acá vas a confirmar el stand elegido, ver el tiempo de reserva y pagar con Mercado Pago.',
            },
          },
          {
            path: 'reservas',
            title: title('Mis reservas'),
            loadComponent: reservationsPlaceholder,
            data: {
              ...FERIANTE_BACK,
              heading: 'Mis reservas',
              intro: 'Acá vas a ver tus reservas, su estado de pago y los comprobantes.',
            },
          },
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
