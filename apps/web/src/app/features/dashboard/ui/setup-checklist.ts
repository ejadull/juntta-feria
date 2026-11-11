import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { type OrganizerEvent } from '../../../shared/events/events.repository';
import { LayoutTemplatesRepository } from '../../layout-editor/data/layout-templates.repository';
import { PaymentAccountRepository } from '../../payment-account/data/payment-account.repository';
import { VenueRepository } from '../../venues/data/venue.repository';

interface Step {
  readonly label: string;
  readonly hint: string;
  readonly link: string;
  readonly query?: Record<string, number>;
  readonly action: string;
  /** null while it is not known (the check failed): shown as pending, never as done. */
  readonly done: boolean;
}

/**
 * "Primeros pasos": what an organization still has to set up before it sells stands. Each step
 * links to the screen that does it; a step whose check fails is shown as pending.
 */
@Component({
  selector: 'app-setup-checklist',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card mt-6" aria-labelledby="setup-title" data-testid="setup-checklist">
      <h2 id="setup-title" class="text-lg font-semibold">Primeros pasos</h2>
      <p class="mt-1 text-sm text-text-muted">
        Lo que falta para empezar a vender stands. Sigue este orden.
      </p>
      @if (steps(); as list) {
        <ol class="mt-4 grid gap-3">
          @for (s of list; track s.label) {
            <li class="flex flex-wrap items-center gap-3" data-testid="setup-step">
              <span
                class="grid size-7 shrink-0 place-items-center rounded-full border border-border-strong text-sm"
                [class]="s.done ? 'bg-available/15' : 'bg-surface-soft'"
                aria-hidden="true"
                >{{ s.done ? '✓' : '·' }}</span
              >
              <span class="min-w-0 flex-1">
                <span class="block font-medium">{{ s.label }}</span>
                <span class="block text-xs text-text-muted"
                  >{{ s.done ? 'Hecho' : 'Pendiente' }} · {{ s.hint }}</span
                >
              </span>
              @if (!s.done) {
                <a class="btn" [routerLink]="s.link" [queryParams]="s.query ?? null">{{
                  s.action
                }}</a>
              }
            </li>
          }
        </ol>
      } @else {
        <p class="mt-4 text-sm text-text-muted" aria-live="polite">Revisando tu configuración…</p>
      }
    </section>
  `,
})
export class SetupChecklist {
  /** The organization events, to know whether one is already on sale. */
  readonly events = input.required<readonly OrganizerEvent[]>();

  private readonly facts = signal<{
    readonly linked: boolean;
    readonly venues: boolean;
    readonly plan: boolean;
  } | null>(null);

  protected readonly steps = computed((): readonly Step[] | null => {
    const facts = this.facts();
    if (!facts) return null;
    const selling = this.events().some((e) => e.status === 'PUBLISHED' || e.status === 'ACTIVE');
    return [
      {
        label: 'Vincular Mercado Pago',
        hint: 'Para cobrar las reservas en tu cuenta.',
        link: '/organizador/mercado-pago',
        action: 'Vincular',
        done: facts.linked,
      },
      {
        label: 'Crear un predio',
        hint: 'El lugar de la feria.',
        link: '/organizador/predios',
        query: { nuevo: 1 },
        action: 'Crear predio',
        done: facts.venues,
      },
      {
        label: 'Dibujar y publicar un plano',
        hint: 'Los stands del predio.',
        link: '/organizador/plano',
        action: 'Ir a los planos',
        done: facts.plan,
      },
      {
        label: 'Crear un evento y publicarlo con precios',
        hint: 'Sectores, precios y publicación.',
        link: '/organizador/eventos',
        query: { nuevo: 1 },
        action: 'Ir a Eventos',
        done: selling,
      },
    ];
  });

  constructor() {
    forkJoin({
      linked: inject(PaymentAccountRepository)
        .status()
        .pipe(catchError(() => of(null))),
      venues: inject(VenueRepository)
        .list()
        .pipe(catchError(() => of(null))),
      templates: inject(LayoutTemplatesRepository)
        .list()
        .pipe(catchError(() => of(null))),
    }).subscribe(({ linked, venues, templates }) =>
      this.facts.set({
        linked: linked?.status === 'LINKED',
        venues: (venues?.length ?? 0) > 0,
        plan: !!templates?.some((t) => t.versions.some((v) => v.status === 'PUBLISHED')),
      }),
    );
  }
}
