import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { currentEvent, EventsRepository } from '../../shared/events/events.repository';

/**
 * Entry of "Editor de plano": resolves the plan of the organization's current event and opens it
 * in the editor. Without events there is no plan to open, so it says what to do next.
 */
@Component({
  selector: 'app-layout-entry-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
      <p class="text-sm font-semibold tracking-wider text-primary-strong">
        ORGANIZADOR · PLANO DEL PREDIO
      </p>
      <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">Editor de plano</h1>
      @switch (state()) {
        @case ('loading') {
          <p class="mt-4 text-text-muted" aria-live="polite">Buscando el plano de tu evento…</p>
        }
        @case ('empty') {
          <div class="card mt-6" data-testid="no-layout">
            <p class="font-semibold">Todavía no hay un plano para editar</p>
            <p class="mt-1 text-sm text-text-muted">
              El plano se abre desde el evento de tu organización. Cuando crees tu primer evento,
              vas a poder editar su plano acá.
            </p>
            <a class="btn btn-primary mt-4" routerLink="/organizador/panel">Volver al panel</a>
          </div>
        }
        @case ('error') {
          <p role="alert" class="card mt-6 text-danger">
            No pudimos cargar tus eventos. Probá de nuevo en unos minutos.
          </p>
        }
      }
    </div>
  `,
})
export class LayoutEntryPage {
  protected readonly state = signal<'loading' | 'empty' | 'error'>('loading');

  constructor() {
    const router = inject(Router);
    inject(EventsRepository)
      .list()
      .subscribe({
        next: (events) => {
          const event = currentEvent(events);
          if (!event) return this.state.set('empty');
          void router.navigate(['/organizador/layouts', event.layoutVersionId, 'editor'], {
            replaceUrl: true,
          });
        },
        error: () => this.state.set('error'),
      });
  }
}
