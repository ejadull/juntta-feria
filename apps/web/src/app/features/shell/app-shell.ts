import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { ApiStatusService, type ApiStatus } from '../../shared/api/api-status.service';
import { DEMO_CONTEXT } from '../../shared/demo-context';

type AreaId = 'organizador' | 'feriante' | 'visitante';

interface NavItem {
  readonly label: string;
  readonly link: string;
  /** Active test against the current URL (the editor URL changes with each version). */
  readonly active: (url: string) => boolean;
  readonly icon: string; // SVG path, 24×24 stroke icon
}

interface Area {
  readonly id: AreaId;
  readonly label: string;
  readonly home: string;
  readonly navLabel: string;
  readonly nav: readonly NavItem[];
}

const pathOf = (url: string): string => url.split(/[?#]/)[0];
const under = (prefix: string) => (url: string) => pathOf(url).startsWith(prefix);
const exactly = (path: string) => (url: string) => pathOf(url) === path;

const ICON = {
  panel: 'M4 4h6v7H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 15h6v5H4z',
  plan: 'M3 4h18v16H3zM3 10h18M10 10v10',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  people:
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a7 7 0 0 1 14 0v1M16 3.5a4 4 0 0 1 0 7M22 21v-1a7 7 0 0 0-4-6.3',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3',
  card: 'M3 6h18v12H3zM3 10h18',
  ticket: 'M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  pin: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
};

const AREAS: readonly Area[] = [
  {
    id: 'organizador',
    label: 'Organizador',
    home: '/organizador/panel',
    navLabel: 'Secciones del organizador',
    nav: [
      {
        label: 'Panel',
        link: '/organizador/panel',
        active: under('/organizador/panel'),
        icon: ICON.panel,
      },
      {
        label: 'Editor de plano',
        link: `/organizador/layouts/${DEMO_CONTEXT.event.layoutVersionId}/editor`,
        active: under('/organizador/layouts/'),
        icon: ICON.plan,
      },
      {
        label: 'Reservas y cobros',
        link: '/organizador/reservas',
        active: under('/organizador/reservas'),
        icon: ICON.receipt,
      },
      {
        label: 'Expositores',
        link: '/organizador/expositores',
        active: under('/organizador/expositores'),
        icon: ICON.people,
      },
    ],
  },
  {
    id: 'feriante',
    label: 'Feriante',
    home: '/feriante/explorar',
    navLabel: 'Secciones del feriante',
    nav: [
      {
        label: 'Explorar stands',
        link: '/feriante/explorar',
        active: under('/feriante/explorar'),
        icon: ICON.search,
      },
      {
        label: 'Reserva y pago',
        link: '/feriante/reserva',
        active: exactly('/feriante/reserva'),
        icon: ICON.card,
      },
      {
        label: 'Mis reservas',
        link: '/feriante/reservas',
        active: under('/feriante/reservas'),
        icon: ICON.ticket,
      },
    ],
  },
  {
    id: 'visitante',
    label: 'Visitante',
    home: '/ferias',
    navLabel: 'Secciones del visitante',
    nav: [
      { label: 'Ferias', link: '/ferias', active: exactly('/ferias'), icon: ICON.calendar },
      {
        label: 'Mapa y expositores',
        link: `/ferias/${DEMO_CONTEXT.event.slug}`,
        active: under('/ferias/'),
        icon: ICON.pin,
      },
    ],
  },
];

function areaOf(url: string): Area {
  const path = pathOf(url);
  const id: AreaId = path.startsWith('/feriante')
    ? 'feriante'
    : path.startsWith('/ferias')
      ? 'visitante'
      : 'organizador';
  return AREAS.find((a) => a.id === id)!;
}

/**
 * App layout for the three areas (mockup "App de escritorio"): side navigation on desktop, top bar
 * on mobile. "Ver como" is a demo control until the area comes from the session (CORE-02).
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-dvh flex-col bg-background text-text lg:flex-row' },
  template: `
    <aside
      class="flex shrink-0 flex-col gap-4 border-b border-border bg-surface-soft px-4 py-3 lg:w-64 lg:border-r lg:border-b-0 lg:px-5 lg:py-6"
    >
      <a [routerLink]="area().home" class="flex items-center gap-2 font-bold tracking-wide">
        <span
          class="grid size-9 place-items-center rounded-md bg-primary text-lg font-bold text-surface"
          aria-hidden="true"
          >j</span
        >
        <span class="leading-tight">
          <span class="block text-xl font-bold tracking-tight text-primary"
            >juntta<span class="text-secondary" aria-hidden="true">.</span></span
          >
          <span class="block text-[0.6875rem] font-semibold tracking-[0.14em] text-text-muted"
            >FERIAS Y ENCUENTROS</span
          >
        </span>
      </a>

      <div>
        <div class="mb-1.5 flex items-center justify-between gap-2">
          <p class="text-xs font-semibold tracking-wider text-text-muted">VER COMO · DEMO</p>
          <span
            data-testid="api-status"
            role="status"
            class="api-status"
            [attr.data-state]="apiStatus()"
          >
            <span class="dot" aria-hidden="true"></span>
            API: {{ apiStatusLabel[apiStatus()] }}
          </span>
        </div>
        <div class="segmented" role="group" aria-label="Ver como (demo)">
          @for (a of areas; track a.id) {
            <button type="button" [attr.aria-pressed]="a.id === area().id" (click)="go(a.home)">
              {{ a.label }}
            </button>
          }
        </div>
      </div>

      @if (area().id === 'organizador') {
        <div class="hidden rounded-xl border border-border bg-surface p-3 lg:block">
          <p class="text-xs font-semibold tracking-wider text-text-muted">ORGANIZACIÓN</p>
          <p class="font-semibold">{{ org.name }}</p>
          <p class="text-xs text-text-muted">{{ org.plan }}</p>
        </div>
      }

      <nav [attr.aria-label]="area().navLabel">
        <ul class="-mx-1 flex gap-1 overflow-x-auto lg:mx-0 lg:flex-col">
          @for (item of area().nav; track item.link) {
            <li class="shrink-0">
              <a
                [routerLink]="item.link"
                class="nav-link"
                [attr.aria-current]="item.active(currentUrl()) ? 'page' : null"
              >
                <svg viewBox="0 0 24 24" class="size-5 shrink-0" aria-hidden="true">
                  <path
                    [attr.d]="item.icon"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linejoin="round"
                  />
                </svg>
                {{ item.label }}
              </a>
            </li>
          }
        </ul>
      </nav>

      <p class="mt-auto hidden rounded-xl bg-primary/10 p-3 text-xs text-primary lg:block">
        <strong>Demo de UX.</strong> Datos ficticios; no se procesa ningún pago real.
      </p>
    </aside>

    <main class="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <router-outlet />
    </main>
  `,
  styles: `
    .api-status {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.75rem;
      color: var(--color-text);
      white-space: nowrap;
    }
    .api-status .dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 999px;
      background: var(--color-blocked-stroke);
    }
    .api-status[data-state='up'] .dot {
      background: var(--color-available);
    }
    .api-status[data-state='down'] .dot {
      background: var(--color-danger);
    }
    .segmented {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.25rem;
      padding: 0.25rem;
      border-radius: 0.75rem;
      background: color-mix(in srgb, var(--color-text-muted) 12%, var(--color-surface-soft));
    }
    .segmented button {
      min-height: 2.25rem;
      padding: 0 0.375rem;
      border-radius: 0.5rem;
      font-size: 0.8125rem;
      color: var(--color-text);
    }
    .segmented button[aria-pressed='true'] {
      background: var(--color-surface);
      font-weight: 600;
      box-shadow: 0 1px 3px rgb(38 53 50 / 0.12);
    }
    .segmented button:focus-visible {
      outline: 2px solid var(--color-selected);
      outline-offset: 1px;
    }
    .nav-link {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      min-height: 2.75rem;
      padding: 0 0.75rem;
      border-radius: 0.625rem;
      font-size: 0.9375rem;
      color: var(--color-text);
      white-space: nowrap;
    }
    .nav-link:hover {
      background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface-soft));
    }
    .nav-link[aria-current='page'] {
      background: color-mix(in srgb, var(--color-primary) 12%, var(--color-surface));
      color: var(--color-primary);
      font-weight: 600;
      box-shadow: inset 3px 0 0 var(--color-primary);
    }
    .nav-link:focus-visible {
      outline: 2px solid var(--color-selected);
      outline-offset: 2px;
    }
  `,
})
export class AppShell {
  protected readonly org = DEMO_CONTEXT.organization;
  protected readonly areas = AREAS;

  private readonly router = inject(Router);
  protected readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  protected readonly area = computed(() => areaOf(this.currentUrl()));

  // ponytail: checked once per load; add polling or a retry button when a page depends on the API.
  protected readonly apiStatus = toSignal<ApiStatus | 'checking', 'checking'>(
    inject(ApiStatusService).check(),
    { initialValue: 'checking' },
  );
  protected readonly apiStatusLabel = {
    checking: 'verificando…',
    up: 'conectada',
    down: 'sin conexión',
  } as const;

  protected go(home: string): void {
    void this.router.navigateByUrl(home);
  }
}
