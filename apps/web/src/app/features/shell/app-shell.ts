import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { ApiStatusService, type ApiStatus } from '../../shared/api/api-status.service';
import { type AreaId } from '../../shared/auth/area';
import { SessionStore } from '../../shared/auth/session.store';
import { ThemePicker } from '../../shared/theme-picker';
import { Toasts } from '../../shared/toast';

interface NavItem {
  readonly label: string;
  readonly link: string;
  /** Active test against the current URL (the editor URL changes with each version). */
  readonly active: (url: string) => boolean;
  readonly icon: string; // SVG path, 24×24 stroke icon
  /** Section heading shown above this item and the following ones until the next heading. */
  readonly group?: string;
}

interface NavGroup {
  readonly heading: string | null;
  readonly items: readonly NavItem[];
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
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a8 8 0 0 1 16 0v1',
  file: 'M6 3h9l3 3v15H6zM14 3v4h4M9 12h6M9 16h6',
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
        label: 'Eventos',
        link: '/organizador/eventos',
        active: under('/organizador/eventos'),
        icon: ICON.calendar,
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
      {
        label: 'Predios',
        link: '/organizador/predios',
        active: under('/organizador/predios'),
        icon: ICON.pin,
        group: 'Gestión',
      },
      {
        label: 'Editor de plano',
        link: '/organizador/plano',
        active: (url) => under('/organizador/plano')(url) || under('/organizador/layouts/')(url),
        icon: ICON.plan,
      },
      {
        label: 'Mercado Pago',
        link: '/organizador/mercado-pago',
        active: under('/organizador/mercado-pago'),
        icon: ICON.card,
        group: 'Administración',
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
        label: 'Mis reservas',
        link: '/feriante/reservas',
        active: under('/feriante/reservas'),
        icon: ICON.ticket,
      },
      {
        label: 'Mi perfil',
        link: '/feriante/perfil',
        active: under('/feriante/perfil'),
        icon: ICON.user,
      },
      {
        label: 'Mis documentos',
        link: '/feriante/documentos',
        active: under('/feriante/documentos'),
        icon: ICON.file,
      },
      {
        label: 'Suscripción',
        link: '/feriante/suscripcion',
        active: under('/feriante/suscripcion'),
        icon: ICON.card,
      },
    ],
  },
  {
    id: 'visitante',
    label: 'Visitante',
    home: '/ferias',
    navLabel: 'Secciones del visitante',
    nav: [
      // The list leads to each fair's map and exhibitors, so one entry covers both screens.
      { label: 'Ferias', link: '/ferias', active: under('/ferias'), icon: ICON.calendar },
    ],
  },
];

/**
 * App layout for the three areas (mockup "App de escritorio"): side navigation on desktop, top bar
 * on mobile. Only the navigation of the area the session's role belongs to is shown.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, ThemePicker, Toasts],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-dvh flex-col overflow-hidden bg-background text-text lg:flex-row' },
  template: `
    <aside
      class="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface-soft px-4 py-2 lg:h-full lg:w-64 lg:flex-col lg:items-stretch lg:justify-start lg:gap-0 lg:overflow-hidden lg:border-r lg:border-b-0 lg:p-0"
    >
      <div class="lg:border-b lg:border-border lg:px-5 lg:py-5">
        <a [routerLink]="area().home" class="logo-link flex items-center gap-2 font-bold tracking-wide">
          <span
            class="grid size-9 place-items-center rounded-md bg-primary text-lg font-bold text-on-primary"
            aria-hidden="true"
            >j</span
          >
          <span class="leading-tight">
            <span class="block text-xl font-bold tracking-tight text-primary-strong"
              >juntta<span class="text-secondary" aria-hidden="true">.</span></span
            >
            <span class="block text-[0.6875rem] font-semibold tracking-[0.14em] text-text-muted"
              >FERIAS Y ENCUENTROS</span
            >
          </span>
        </a>
      </div>

      <button
        type="button"
        class="menu-button lg:hidden"
        popovertarget="app-menu"
        popovertargetaction="toggle"
        aria-controls="app-menu"
      >
        <svg viewBox="0 0 24 24" class="size-5 shrink-0" aria-hidden="true">
          <path
            d="M4 7h16M4 12h16M4 17h16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
        Secciones
      </button>

      <!-- Below lg this is a popover under the menu button; from lg up it is the sidebar. -->
      <div #menu id="app-menu" popover class="app-menu">
        <nav
          [attr.aria-label]="area().navLabel"
          class="flex flex-col gap-4 p-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:px-4 lg:py-4"
        >
          @for (group of groups(); track $index) {
            <div class="flex flex-col gap-1">
              @if (group.heading) {
                <p
                  class="px-3 text-[0.6875rem] font-semibold tracking-[0.14em] text-text-muted uppercase"
                >
                  {{ group.heading }}
                </p>
              }
              <ul class="flex flex-col gap-1">
                @for (item of group.items; track item.link) {
                  <li>
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
            </div>
          }
        </nav>

        <div
          class="flex flex-col gap-3 border-t border-border px-4 py-3 lg:px-5 lg:py-4"
        >
          <p class="rounded-xl bg-primary/10 p-3 text-xs text-primary-strong">
            <strong>Entorno de prueba.</strong> Los pagos se hacen en el sandbox de Mercado Pago.
          </p>
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
      </div>
    </aside>

    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <header
        class="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 sm:px-6 lg:h-16"
      >
        <p class="truncate text-sm font-semibold tracking-wider text-text-muted uppercase">
          {{ area().label }}
        </p>
        <div class="flex min-w-0 items-center gap-3">
          @if (session.user(); as user) {
            @if (session.memberships().length > 1) {
              <select class="org-select" aria-label="Organización" (change)="chooseTenant($event)">
                @for (m of session.memberships(); track m.tenantId) {
                  <option [value]="m.tenantId" [selected]="m.tenantId === session.tenantId()">
                    {{ m.tenantName }}
                  </option>
                }
              </select>
            } @else if (orgName(); as org) {
              <span
                class="hidden max-w-48 truncate rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-on-primary sm:inline-block"
                >{{ org }}</span
              >
            }
            <span class="hidden truncate text-sm font-medium md:inline"
              >¡Hola, {{ firstName() }}!</span
            >
          } @else {
            <a class="btn btn-primary min-h-11 justify-center" routerLink="/ingresar">Ingresar</a>
          }
          <button
            type="button"
            class="avatar"
            popovertarget="user-menu"
            aria-label="Abrir menú de cuenta"
          >
            {{ initials() }}
          </button>
          <div
            id="user-menu"
            popover
            aria-label="Menú de cuenta"
            class="user-menu w-72 rounded-xl border border-border bg-surface p-4 text-sm text-text shadow-lg"
          >
            @if (session.user(); as user) {
              <p class="truncate font-medium" data-testid="session-email">{{ user.email }}</p>
              <p class="text-xs text-text-muted" data-testid="session-area">
                Área: {{ area().label }}
              </p>
            }
            <div [class.mt-3]="session.user()"><app-theme-picker /></div>
            @if (session.user()) {
              <button
                type="button"
                class="btn mt-3 min-h-11 w-full justify-center"
                (click)="logout()"
              >
                Salir
              </button>
            }
          </div>
        </div>
      </header>

      <main id="main" tabindex="-1" class="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <router-outlet />
      </main>
    </div>

    <app-toasts />
  `,
  styles: `
    .org-select {
      min-height: 2.75rem;
      max-width: 12rem;
      padding: 0 0.75rem;
      border: 0;
      border-radius: 999px;
      background: var(--color-primary);
      color: var(--color-on-primary);
      font-size: 0.875rem;
      font-weight: 600;
    }
    .org-select option {
      background: var(--color-surface);
      color: var(--color-text);
    }
    .org-select:focus-visible,
    .avatar:focus-visible {
      outline: 2px solid var(--color-selected);
      outline-offset: 2px;
    }
    .avatar {
      display: grid;
      place-items: center;
      width: max(2.75rem, var(--target-size, 0px));
      height: max(2.75rem, var(--target-size, 0px));
      border: 1px solid var(--color-border-strong);
      border-radius: 999px;
      background: var(--color-surface-soft);
      color: var(--color-text);
      font-size: 0.875rem;
      font-weight: 700;
    }
    .avatar {
      anchor-name: --account-button;
    }
    .user-menu {
      /* Fallback without anchor positioning: pinned under the top bar, right edge. */
      inset: 3.75rem 1rem auto auto;
      margin: 0;
      /* Tethered to the avatar; flips above or to the other side when it would not fit. */
      position-anchor: --account-button;
      top: anchor(--account-button bottom);
      right: anchor(--account-button right);
      left: auto;
      bottom: auto;
      margin-block-start: 0.5rem;
      position-try-fallbacks: flip-block, flip-inline, flip-block flip-inline;
      max-width: calc(100dvw - 1rem);
    }
    .menu-button {
      anchor-name: --menu-button;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      min-height: 2.75rem;
      padding: 0 0.875rem;
      border: 1px solid var(--color-border-strong);
      border-radius: 999px;
      background: var(--color-surface);
      color: var(--color-text);
      font-size: 0.875rem;
      font-weight: 600;
    }
    @media (min-width: 64rem) {
      .menu-button {
        display: none;
      }
    }
    .menu-button:focus-visible,
    .logo-link:focus-visible {
      outline: 2px solid var(--color-selected);
      outline-offset: 2px;
    }
    /* One nav tree at every size: a popover under the menu button below lg, the sidebar above. */
    .app-menu {
      position: fixed;
      /* Without anchor positioning it opens at a fixed offset from the top, under the bar. */
      inset: 3.5rem auto auto 0.75rem;
      inset-block-start: anchor(--menu-button bottom);
      inset-inline-start: auto;
      inset-inline-end: 0.75rem;
      margin: 0;
      margin-block-start: 0.5rem;
      width: min(22rem, calc(100dvw - 1.5rem));
      height: fit-content;
      max-height: calc(100dvh - 5rem);
      overflow-y: auto;
      padding: 0;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface-soft);
      color: var(--color-text);
      box-shadow: 0 16px 40px -16px rgb(0 0 0 / 0.45);
    }
    @media (min-width: 64rem) {
      .app-menu {
        position: static;
        display: flex;
        flex: 1 1 0;
        flex-direction: column;
        min-height: 0;
        width: auto;
        height: auto;
        max-height: none;
        margin: 0;
        overflow: visible;
        border: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
      }
    }
    @media (prefers-reduced-motion: no-preference) {
      .app-menu:popover-open {
        transition:
          opacity 0.15s ease,
          translate 0.15s ease;
        @starting-style {
          opacity: 0;
          translate: 0 -0.25rem;
        }
      }
    }
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
    .nav-link {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      min-height: max(2.75rem, var(--target-size, 0px));
      padding: 0 0.75rem;
      border-radius: 999px;
      font-size: 0.9375rem;
      color: var(--color-text);
      white-space: nowrap;
    }
    .nav-link:hover {
      background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface-soft));
    }
    .nav-link[aria-current='page'] {
      background: var(--color-primary);
      color: var(--color-on-primary);
      font-weight: 600;
      /* Not color alone: an inner ring marks the current page (also in forced colors below). */
      box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-on-primary) 55%, transparent);
    }
    @media (forced-colors: active) {
      .nav-link[aria-current='page'] {
        forced-color-adjust: none;
        background: Highlight;
        color: HighlightText;
        outline: 2px solid ButtonText;
        outline-offset: -4px;
      }
      .avatar,
      .menu-button,
      .org-select {
        border: 1px solid ButtonText;
      }
      .api-status .dot {
        forced-color-adjust: none;
        background: ButtonText;
      }
    }
    .nav-link:focus-visible {
      outline: 2px solid var(--color-selected);
      outline-offset: 2px;
    }
  `,
})
export class AppShell {
  protected readonly session = inject(SessionStore);
  protected readonly orgName = computed(
    () =>
      this.session.memberships().find((m) => m.tenantId === this.session.tenantId())?.tenantName,
  );

  protected readonly firstName = computed(() => {
    const user = this.session.user();
    if (!user) return '';
    return user.fullName?.trim().split(/\s+/)[0] || user.email.split('@')[0];
  });
  protected readonly initials = computed(() => {
    const user = this.session.user();
    if (!user) return '·';
    const words = user.fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
    const letters = words.length
      ? words
          .slice(0, 2)
          .map((w) => w[0])
          .join('')
      : user.email[0];
    return letters.toUpperCase();
  });

  private readonly router = inject(Router);
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');
  protected readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  private readonly closeMenuOnNavigation = effect(() => {
    this.currentUrl();
    const menu = this.menu()?.nativeElement;
    if (typeof menu?.hidePopover !== 'function') return;
    try {
      menu.hidePopover();
    } catch {
      // not open (always the case in the sidebar layout)
    }
  });
  protected readonly area = computed(() => AREAS.find((a) => a.id === this.session.area())!);
  /** Consecutive items form a group; an item with `group` starts a new one. */
  protected readonly groups = computed((): readonly NavGroup[] =>
    this.area().nav.reduce<readonly NavGroup[]>((acc, item) => {
      const last = acc[acc.length - 1];
      if (!last || item.group) return [...acc, { heading: item.group ?? null, items: [item] }];
      return [...acc.slice(0, -1), { ...last, items: [...last.items, item] }];
    }, []),
  );

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

  protected chooseTenant(event: Event): void {
    this.session.selectTenant((event.target as HTMLSelectElement).value);
    // The new organization may mean another kind of role, so land on that area's home.
    void this.router.navigateByUrl(this.area().home);
  }

  protected logout(): void {
    this.session.logout().subscribe(() => void this.router.navigateByUrl('/ingresar'));
  }
}
