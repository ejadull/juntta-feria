import { Routes } from '@angular/router';
import { EventMetricsRepository } from './features/dashboard/data/event-metrics.repository';
import { InMemoryEventMetricsRepository } from './features/dashboard/data/in-memory-event-metrics.repository';
import { ExhibitorRepository } from './features/exhibitors/data/exhibitor.repository';
import { InMemoryExhibitorRepository } from './features/exhibitors/data/in-memory-exhibitor.repository';
import { InMemoryLayoutRepository } from './features/layout-editor/data/in-memory-layout.repository';
import { LayoutRepository } from './features/layout-editor/data/layout.repository';
import { APP_NAME } from './shared/demo-context';

const title = (section: string): string => `${section} · ${APP_NAME}`;
const notFound = () => import('./features/not-found.page').then((m) => m.NotFoundPage);

// ponytail: in-memory adapters are provided per route until the API exists (LAY-01, REP-01, EXH-01);
// swap each `useFactory` for its Http adapter here, without touching components.
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'organizador/panel' },
  {
    path: 'organizador',
    loadComponent: () =>
      import('./features/organizer-shell/organizer-shell').then((m) => m.OrganizerShell),
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
        loadComponent: () =>
          import('./features/reservations/reservations-placeholder.page').then(
            (m) => m.ReservationsPlaceholderPage,
          ),
      },
      {
        path: 'expositores',
        title: title('Expositores'),
        loadComponent: () =>
          import('./features/exhibitors/exhibitors.page').then((m) => m.ExhibitorsPage),
        providers: [
          { provide: ExhibitorRepository, useFactory: () => new InMemoryExhibitorRepository() },
        ],
      },
      { path: '**', title: title('Página no encontrada'), loadComponent: notFound },
    ],
  },
  { path: '**', title: title('Página no encontrada'), loadComponent: notFound },
];
