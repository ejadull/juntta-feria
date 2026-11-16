import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
} from '@angular/core';
import { catchError, concatMap, forkJoin, from, map, of, toArray } from 'rxjs';
import { messageFor } from '../../../shared/auth/problem';
import { centsToInput, parsePesosToCents } from '../../../shared/decimal';
import { valueOf } from '../../../shared/forms';
import { fromPolygon } from '../../layout-editor/domain/geometry';
import { LayoutRepository } from '../../layout-editor/data/layout.repository';
import {
  EventInventoryRepository,
  type EditableStandStatus,
  type SectorDto,
  type StandDto,
} from '../data/event-inventory.repository';
import { diffStand, groupChanges, type StandDelta, type StandDraft } from '../domain/stand-changes';

const LOAD_FAILED = 'No pudimos cargar los stands. Probá de nuevo en unos minutos.';
const SAVE_FAILED = 'No pudimos guardar este cambio. Probá de nuevo en unos minutos.';
const ASSIGNED_LOCKED = 'Un stand asignado no puede cambiar de estado.';
const STALE = 'El stand o el sector ya no existe en este evento. Recargá la página.';
const BAD_PRICE = 'Ingresá un precio en pesos, con hasta 2 decimales.';
const MAX_PRICE_CENTS = 1_000_000_000_000;

const STATUS_LABEL: Record<EditableStandStatus, string> = {
  AVAILABLE: 'Disponible',
  BLOCKED: 'Bloqueado',
  DISABLED: 'Deshabilitado',
};
const AREA = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

interface GroupResult {
  readonly ids: readonly string[];
  readonly saved: readonly StandDto[];
  readonly error: string | null;
}

/** "Stands y precios" tab (EVT-01, P09): inline price, sector and status, saved in one go. */
@Component({
  selector: 'app-stands-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/responsive-table.css',
  template: `
    <section aria-labelledby="stands-title">
      <h2 id="stands-title" class="text-lg font-semibold">Stands y precios</h2>
      <p class="mt-1 text-sm text-text-muted">
        Precios en pesos argentinos (ARS). Para publicar, todo stand que no esté deshabilitado
        necesita precio. Los precios pueden cambiar después de publicar: las reservas ya hechas
        conservan el suyo.
      </p>

      @if (loadError(); as message) {
        <p role="alert" class="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-text">{{ message }}</p>
      } @else if (stands(); as rows) {
        @if (rows.length === 0) {
          <p class="mt-4 text-sm text-text-muted" data-testid="no-stands">
            El plano de este evento no tiene stands.
          </p>
        } @else {
          <div class="mt-4 flex flex-wrap items-end gap-3">
            <label class="grid gap-1 text-sm">
              <span>Precio para los stands sin precio</span>
              <input
                class="field w-48"
                type="text"
                inputmode="decimal"
                autocomplete="off"
                placeholder="Ej.: 150000"
                [attr.aria-invalid]="bulkError() ? 'true' : null"
                [attr.aria-describedby]="bulkError() ? 'bulk-error' : null"
                [value]="bulkPrice()"
                (input)="bulkPrice.set(valueOf($event))"
              />
            </label>
            <button type="button" class="btn" (click)="applyBulk()">Aplicar</button>
            <p class="text-xs text-text-muted" aria-live="polite" data-testid="unpriced-count">
              {{ unpriced() }} sin precio de {{ rows.length }} stands
            </p>
          </div>
          @if (bulkError(); as message) {
            <p id="bulk-error" class="mt-1 text-sm text-danger">{{ message }}</p>
          }

          <div
            role="region"
            tabindex="0"
            aria-label="Stands del evento"
            class="table-wrapper card mt-4 overflow-x-auto p-0"
          >
            <table class="stack-table w-full text-left text-sm">
              <caption class="sr-only">
                Stands del evento con precio, sector y estado
              </caption>
              <thead class="border-b border-border text-xs tracking-wider text-text-muted">
                <tr>
                  <th scope="col" class="px-3 py-3">Código</th>
                  <th scope="col" class="px-3 py-3">Área (m²)</th>
                  <th scope="col" class="px-3 py-3">Sector</th>
                  <th scope="col" class="px-3 py-3">Estado</th>
                  <th scope="col" class="px-3 py-3">Precio (ARS)</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                @for (s of rows; track s.id) {
                  <tr data-testid="stand-row" [attr.data-stand]="s.code">
                    <th scope="row" class="px-3 py-2 font-medium">{{ s.code }}</th>
                    <td data-label="Área (m²)" class="px-3 py-2">{{ area(s) }}</td>
                    <td data-label="Sector" class="px-3 py-2">
                      <select
                        class="field"
                        [attr.aria-label]="'Sector de ' + s.code"
                        (change)="setSector(s.id, valueOf($event))"
                      >
                        <option value="" [selected]="draft(s.id).sectorId === null">
                          Sin sector
                        </option>
                        @for (sector of sectors(); track sector.id) {
                          <option
                            [value]="sector.id"
                            [selected]="draft(s.id).sectorId === sector.id"
                          >
                            {{ sector.name }}
                          </option>
                        }
                      </select>
                    </td>
                    <td data-label="Estado" class="px-3 py-2">
                      @if (s.status === 'ASSIGNED') {
                        <span title="Lo asigna una reserva confirmada">Asignado</span>
                      } @else {
                        <select
                          class="field"
                          [attr.aria-label]="'Estado de ' + s.code"
                          (change)="setStatus(s.id, valueOf($event))"
                        >
                          @for (st of statuses; track st) {
                            <option [value]="st" [selected]="draft(s.id).status === st">
                              {{ statusLabel[st] }}
                            </option>
                          }
                        </select>
                      }
                    </td>
                    <td data-label="Precio (ARS)" class="px-3 py-2">
                      <input
                        class="field w-32"
                        type="text"
                        inputmode="decimal"
                        autocomplete="off"
                        [attr.aria-label]="'Precio de ' + s.code"
                        [attr.aria-invalid]="rowError(s.id) ? 'true' : null"
                        [attr.aria-describedby]="rowError(s.id) ? 'row-error-' + s.id : null"
                        [value]="draft(s.id).price"
                        (input)="setPrice(s.id, valueOf($event))"
                      />
                      @if (rowError(s.id); as message) {
                        <p [id]="'row-error-' + s.id" class="mt-1 text-xs text-danger">
                          {{ message }}
                        </p>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <div class="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              class="btn btn-primary"
              [disabled]="busy() || pending() === 0"
              (click)="save()"
            >
              Guardar cambios
            </button>
            <p class="text-sm text-text-muted" aria-live="polite" data-testid="pending-count">
              @if (pending() === 0) {
                Sin cambios para guardar.
              } @else {
                {{ pending() }} {{ pending() === 1 ? 'stand con cambios' : 'stands con cambios' }}
                sin guardar.
              }
            </p>
          </div>
          @if (notice(); as message) {
            <p role="status" class="mt-3 rounded-lg bg-available/15 p-3 text-sm text-text">
              {{ message }}
            </p>
          }
        }
      } @else {
        <p class="mt-4 text-sm text-text-muted" aria-live="polite">Cargando stands…</p>
      }
    </section>
  `,
})
export class StandsPanel {
  readonly eventId = input.required<string>();
  /** The event plan, only to show each stand area; without it the column reads an em dash. */
  readonly layoutVersionId = input<string | null>(null);

  private readonly repository = inject(EventInventoryRepository);
  private readonly layouts = inject(LayoutRepository, { optional: true });
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly valueOf = valueOf;
  protected readonly statuses = Object.keys(STATUS_LABEL) as EditableStandStatus[];
  protected readonly statusLabel = STATUS_LABEL;

  protected readonly stands = signal<readonly StandDto[] | null>(null);
  protected readonly sectors = signal<readonly SectorDto[]>([]);
  protected readonly loadError = signal<string | null>(null);
  private readonly drafts = signal<ReadonlyMap<string, StandDraft>>(new Map());
  private readonly rowErrors = signal<ReadonlyMap<string, string>>(new Map());
  private readonly areas = signal<ReadonlyMap<string, number>>(new Map());
  protected readonly busy = signal(false);
  protected readonly notice = signal('');
  protected readonly bulkPrice = signal('');
  protected readonly bulkError = signal<string | null>(null);

  protected readonly unpriced = computed(
    () => (this.stands() ?? []).filter((s) => !s.hasPrice && s.status !== 'DISABLED').length,
  );
  protected readonly pending = computed(
    () =>
      (this.stands() ?? []).filter((s) => diffStand(s, this.draft(s.id)).kind !== 'unchanged')
        .length,
  );

  constructor() {
    afterNextRender(() => this.load(), { injector: this.injector });
  }

  protected draft(id: string): StandDraft {
    return this.drafts().get(id) ?? { price: '', sectorId: null, status: 'AVAILABLE' };
  }

  protected rowError(id: string): string | null {
    return this.rowErrors().get(id) ?? null;
  }

  protected area(stand: StandDto): string {
    const value = this.areas().get(stand.layoutObjectId);
    return value === undefined ? '—' : AREA.format(value);
  }

  protected setPrice(id: string, price: string): void {
    this.patchDraft(id, { price });
  }

  protected setSector(id: string, sectorId: string): void {
    this.patchDraft(id, { sectorId: sectorId === '' ? null : sectorId });
  }

  protected setStatus(id: string, status: string): void {
    this.patchDraft(id, { status: status as EditableStandStatus });
  }

  /** Fills the price of every stand that still has none (and is not disabled). */
  protected applyBulk(): void {
    const cents = parsePesosToCents(this.bulkPrice());
    if (cents === null || cents > MAX_PRICE_CENTS) {
      this.bulkError.set(BAD_PRICE);
      this.focusInvalid();
      return;
    }
    this.bulkError.set(null);
    const text = centsToInput(cents);
    for (const s of this.stands() ?? []) {
      if (!s.hasPrice && this.draft(s.id).status !== 'DISABLED')
        this.patchDraft(s.id, { price: text });
    }
  }

  protected save(): void {
    const errors = new Map<string, string>();
    const changes: { id: string; delta: StandDelta }[] = [];
    for (const s of this.stands() ?? []) {
      const result = diffStand(s, this.draft(s.id));
      if (result.kind === 'invalid') errors.set(s.id, result.message);
      else if (result.kind === 'changed') changes.push({ id: s.id, delta: result.delta });
    }
    this.rowErrors.set(errors);
    this.notice.set('');
    if (errors.size > 0) {
      this.focusInvalid();
      return;
    }
    this.busy.set(true);
    from(groupChanges(changes))
      .pipe(
        concatMap((group) =>
          this.repository.updateStands(this.eventId(), group).pipe(
            map((saved): GroupResult => ({ ids: group.standIds, saved, error: null })),
            catchError((error: unknown) =>
              of<GroupResult>({
                ids: group.standIds,
                saved: [],
                error: messageFor(
                  error,
                  {},
                  { 409: ASSIGNED_LOCKED, 400: STALE, 404: STALE },
                  SAVE_FAILED,
                ),
              }),
            ),
          ),
        ),
        toArray(),
      )
      .subscribe((results) => this.afterSave(results));
  }

  private afterSave(results: readonly GroupResult[]): void {
    const saved = new Map(results.flatMap((r) => r.saved).map((s) => [s.id, s]));
    const failed = new Map<string, string>();
    for (const r of results) if (r.error) for (const id of r.ids) failed.set(id, r.error);
    this.stands.update((rows) => (rows ?? []).map((s) => saved.get(s.id) ?? s));
    this.drafts.update((current) => {
      const next = new Map(current);
      for (const s of saved.values()) next.set(s.id, this.initialDraft(s));
      return next;
    });
    this.rowErrors.set(failed);
    this.busy.set(false);
    const noun = (n: number) => `${n} ${n === 1 ? 'stand' : 'stands'}`;
    this.notice.set(
      failed.size === 0
        ? `Guardamos ${noun(saved.size)}.`
        : `No pudimos guardar ${noun(failed.size)}: revisá el aviso de cada fila.`,
    );
    if (failed.size > 0) this.focusInvalid();
  }

  private focusInvalid(): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      { injector: this.injector },
    );
  }

  private patchDraft(id: string, patch: Partial<StandDraft>): void {
    this.drafts.update((current) => new Map(current).set(id, { ...this.draft(id), ...patch }));
    if (this.rowErrors().has(id))
      this.rowErrors.update((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
  }

  private initialDraft(stand: StandDto): StandDraft {
    return {
      price: stand.hasPrice ? centsToInput(stand.priceCents) : '',
      sectorId: stand.sectorId,
      status: stand.status,
    };
  }

  private load(): void {
    forkJoin([
      this.repository.listStands(this.eventId()),
      this.repository.listSectors(this.eventId()),
    ]).subscribe({
      next: ([stands, sectors]) => {
        this.sectors.set(sectors);
        this.drafts.set(new Map(stands.map((s) => [s.id, this.initialDraft(s)])));
        this.stands.set(stands);
        this.loadError.set(null);
      },
      error: () => this.loadError.set(LOAD_FAILED),
    });
    const version = this.layoutVersionId();
    if (!this.layouts || !version) return;
    this.layouts.get(version).subscribe({
      next: (layout) =>
        this.areas.set(
          new Map(
            layout.objects.flatMap((o) => {
              const rect = fromPolygon(o.geometry);
              return o.kind === 'STAND' && rect ? [[o.id, rect.w * rect.h] as const] : [];
            }),
          ),
        ),
      // The area is a nicety: without the plan the column reads an em dash and prices still work.
      error: () => undefined,
    });
  }
}
