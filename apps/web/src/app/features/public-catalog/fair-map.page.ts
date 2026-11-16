import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { forkJoin, map, startWith, switchMap } from 'rxjs';
import { PublicCatalogRepository, STATUS_LABEL } from './data/public-catalog.repository';
import { standsOf } from './domain/stand-filters';
import { dataOf, errorOf, toLoaded } from './ui/loaded';
import { StandDetailDialog } from './ui/stand-detail-dialog';
import { StandMap } from './ui/stand-map/stand-map';

/** P14 visitante: public map + directory (INV-08/AC-11: only consented public profiles). */
@Component({
  selector: 'app-fair-map-page',
  imports: [RouterLink, StandMap, StandDetailDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 lg:px-8">
      @if (error(); as message) {
        <div role="alert" class="card">
          <h1 class="text-xl font-semibold">{{ message }}</h1>
          <a routerLink="/ferias" class="btn mt-4">Ver todas las ferias</a>
        </div>
      } @else if (data(); as d) {
        <header>
          <p class="text-sm font-semibold tracking-wider text-primary-strong">
            VISITANTE · {{ d.event.organizerName }}
          </p>
          <h1 class="mt-1 text-3xl font-semibold">{{ d.event.name }}</h1>
          <p class="mt-1 text-text-muted">
            {{ d.event.venueName }}{{ d.event.venueAddress ? ', ' + d.event.venueAddress : '' }}
          </p>
        </header>

        <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <app-stand-map
            class="h-[26rem] rounded-xl border border-border lg:h-[34rem]"
            [map]="d.map"
            [selectedId]="selectedId()"
            (select)="onSelect($event)"
          />
          <section class="stand-card card self-start" aria-live="polite">
            @if (selected(); as s) {
              <h2 class="text-lg font-semibold">Stand {{ s.code }}</h2>
              <p class="text-sm text-text-muted">
                {{ s.sector ?? 'Sin sector' }} · {{ s.areaM2 }} m² · {{ statusLabel[s.status] }}
              </p>
              @if (s.exhibitor; as ex) {
                <p class="mt-3 font-semibold">{{ ex.name }}</p>
                <p class="text-sm text-text-muted">{{ ex.category }}</p>
              } @else if (s.status === 'OCCUPIED') {
                <p class="mt-3 text-sm text-text-muted">
                  Quien expone acá prefirió no publicar su perfil.
                </p>
              }
            } @else {
              <h2 class="text-lg font-semibold">Explorá el plano</h2>
              <p class="mt-1 text-sm text-text-muted">
                Tocá un stand para ver quién expone, o buscalo en el directorio.
              </p>
            }
          </section>
        </div>

        <section class="directory" aria-labelledby="directory-title">
          <h2 id="directory-title" class="text-xl font-semibold">
            Expositores <span class="text-text-muted">({{ d.exhibitors.length }})</span>
          </h2>
          @if (d.exhibitors.length === 0) {
            <p class="card mt-3 text-sm text-text-muted" data-testid="no-exhibitors">
              Todavía no hay expositores con perfil público en esta feria. Mirá el plano para ver
              qué stands están disponibles.
            </p>
          }
          <ul class="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            @for (e of d.exhibitors; track e.name) {
              <li class="card flex flex-col gap-1 p-4">
                <p class="font-semibold">{{ e.name }}</p>
                <p class="text-sm text-text-muted">{{ e.category }}</p>
                <p class="text-sm">{{ e.description }}</p>
                @if (e.standCode; as code) {
                  <button type="button" class="btn mt-2 self-start" (click)="locate(code)">
                    Ver stand {{ code }} en el plano
                  </button>
                }
              </li>
            }
          </ul>
        </section>
        @if (dialogStand(); as open) {
          <app-stand-detail-dialog [stand]="open" [plan]="stands()" (closed)="dialogId.set(null)" />
        }
      } @else {
        <p class="text-text-muted" aria-live="polite">Cargando mapa…</p>
      }
    </section>
  `,
})
export class FairMapPage {
  /** Route param `:slug` (withComponentInputBinding). */
  readonly slug = input.required<string>();

  protected readonly statusLabel = STATUS_LABEL;
  protected readonly selectedId = signal<string | null>(null);

  private readonly repo = inject(PublicCatalogRepository);
  private readonly state = toSignal(
    toObservable(this.slug).pipe(
      switchMap((slug) =>
        forkJoin({
          events: this.repo.listEvents(),
          map: this.repo.getMap(slug),
          exhibitors: this.repo.listExhibitors(slug),
        }).pipe(
          map(({ events, ...rest }) => {
            const event = events.find((e) => e.slug === slug);
            if (!event) throw new Error(`Unknown event ${slug}`);
            return { event, ...rest };
          }),
          toLoaded('No encontramos el mapa público de esta feria.'),
          startWith(null),
        ),
      ),
    ),
    { initialValue: null },
  );
  protected readonly data = computed(() => dataOf(this.state()));
  protected readonly error = computed(() => errorOf(this.state()));

  private readonly stands = computed(() => {
    const d = this.data();
    return d ? standsOf(d.map) : [];
  });
  protected readonly selected = computed(
    () => this.stands().find((s) => s.id === this.selectedId()) ?? null,
  );

  /** Stand whose modal is open; only stands with a public exhibitor profile open one. */
  protected readonly dialogId = signal<string | null>(null);
  protected readonly dialogStand = computed(
    () => this.stands().find((s) => s.id === this.dialogId()) ?? null,
  );

  protected onSelect(id: string): void {
    this.selectedId.set(id);
    if (this.stands().find((s) => s.id === id)?.exhibitor) this.dialogId.set(id);
  }

  protected locate(code: string): void {
    this.selectedId.set(this.stands().find((s) => s.code === code)?.id ?? null);
  }
}
