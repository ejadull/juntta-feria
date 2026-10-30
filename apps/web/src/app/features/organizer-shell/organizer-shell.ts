import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { DEMO_CONTEXT } from '../../shared/demo-context';

interface NavItem {
  readonly label: string;
  readonly link: string;
  /** Active when the current URL starts with this prefix (the editor URL changes with each version). */
  readonly match: string;
  readonly icon: string; // SVG path, 24×24 stroke icon
}

const NAV: readonly NavItem[] = [
  {
    label: 'Panel',
    link: '/organizador/panel',
    match: '/organizador/panel',
    icon: 'M4 4h6v7H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 15h6v5H4z',
  },
  {
    label: 'Editor de plano',
    link: `/organizador/layouts/${DEMO_CONTEXT.event.layoutVersionId}/editor`,
    match: '/organizador/layouts/',
    icon: 'M3 4h18v16H3zM3 10h18M10 10v10',
  },
  {
    label: 'Reservas y cobros',
    link: '/organizador/reservas',
    match: '/organizador/reservas',
    icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  },
  {
    label: 'Expositores',
    link: '/organizador/expositores',
    match: '/organizador/expositores',
    icon: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a7 7 0 0 1 14 0v1M16 3.5a4 4 0 0 1 0 7M22 21v-1a7 7 0 0 0-4-6.3',
  },
];

/** Organizer app layout (mockup "App de escritorio"): side navigation on desktop, top bar on mobile. */
@Component({
  selector: 'app-organizer-shell',
  imports: [RouterOutlet, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-dvh flex-col bg-background text-text lg:flex-row' },
  template: `
    <aside
      class="flex shrink-0 flex-col gap-4 border-b border-border bg-surface-soft px-4 py-3 lg:w-64 lg:border-r lg:border-b-0 lg:px-5 lg:py-6"
    >
      <a routerLink="/organizador/panel" class="flex items-center gap-2 font-bold tracking-wide">
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

      <div class="hidden rounded-xl border border-border bg-surface p-3 lg:block">
        <p class="text-xs font-semibold tracking-wider text-text-muted">ORGANIZACIÓN</p>
        <p class="font-semibold">{{ org.name }}</p>
        <p class="text-xs text-text-muted">{{ org.plan }}</p>
      </div>

      <nav aria-label="Secciones del organizador">
        <ul class="-mx-1 flex gap-1 overflow-x-auto lg:mx-0 lg:flex-col">
          @for (item of nav; track item.link) {
            <li class="shrink-0">
              <a
                [routerLink]="item.link"
                class="nav-link"
                [attr.aria-current]="currentUrl().startsWith(item.match) ? 'page' : null"
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
export class OrganizerShell {
  protected readonly org = DEMO_CONTEXT.organization;
  protected readonly nav = NAV;

  private readonly router = inject(Router);
  protected readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
}
