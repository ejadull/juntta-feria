import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import {
  InvitationRepository,
  type CreatedInvitationDto,
  type InvitationDto,
  type InvitationStatus,
} from '../data/invitation.repository';

const STATUS: Record<InvitationStatus, { label: string; icon: string; tone: string }> = {
  PENDING: { label: 'Pendiente', icon: '…', tone: 'bg-surface-soft' },
  ACCEPTED: { label: 'Usada', icon: '✓', tone: 'bg-available/15' },
  EXPIRED: { label: 'Vencida', icon: '!', tone: 'bg-danger/10' },
  REVOKED: { label: 'Revocada', icon: '×', tone: 'bg-danger/10' },
};

const EXPIRY_DAYS = [1, 3, 7, 14, 30] as const;
const EMAIL_SHAPE = /^\S+@\S+\.\S+$/;

const LOAD_FAILED = 'No pudimos cargar las invitaciones. Probá de nuevo en unos minutos.';
const CREATE_FAILED = 'No pudimos crear la invitación. Revisá los datos y probá de nuevo.';
const REVOKE_FAILED = 'No pudimos revocar la invitación. Probá de nuevo.';
const BAD_EMAIL = 'Ingresá un email válido o dejalo vacío.';

/**
 * EXH-04 (organizer side): invites exhibitors. Sign-up is Google-only, so an invitation is the
 * only way in. The link comes back once, on creation; the API never stores or returns it again.
 */
@Component({
  selector: 'app-invitations-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card mt-6" aria-labelledby="invitations-heading">
      <h2 id="invitations-heading" class="text-lg font-semibold">Invitaciones</h2>
      <p class="mt-1 text-sm text-text-muted">
        Los feriantes entran solo por invitación: les mandás un link de un solo uso y crean su
        cuenta con "Ingresar con Google".
      </p>

      <form class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2" (submit)="create($event)" novalidate>
        <label class="grid gap-1 text-sm">
          <span>Nombre</span>
          <input
            class="field"
            type="text"
            aria-label="Nombre"
            autocomplete="off"
            [value]="name()"
            (input)="name.set(valueOf($event))"
          />
        </label>
        <label class="grid gap-1 text-sm">
          <span>Email</span>
          <input
            class="field"
            type="email"
            aria-label="Email"
            autocomplete="off"
            aria-describedby="invite-email-hint"
            [value]="email()"
            (input)="email.set(valueOf($event))"
          />
        </label>
        <p id="invite-email-hint" class="text-xs text-text-muted sm:col-span-2">
          Opcional. Si lo ponés, solo esa cuenta de Google puede aceptar la invitación.
        </p>
        <label class="grid gap-1 text-sm">
          <span>Teléfono (WhatsApp)</span>
          <input
            class="field"
            type="tel"
            aria-label="Teléfono (WhatsApp)"
            autocomplete="off"
            placeholder="+54 9 299 123-4567"
            [value]="phone()"
            (input)="phone.set(valueOf($event))"
          />
        </label>
        <label class="grid gap-1 text-sm">
          <span>Vence en</span>
          <select
            class="field"
            aria-label="Vence en"
            (change)="expiresInDays.set(+valueOf($event))"
          >
            @for (d of expiryDays; track d) {
              <option [value]="d" [selected]="d === expiresInDays()">
                {{ d === 1 ? '1 día' : d + ' días' }}
              </option>
            }
          </select>
        </label>
        <div class="sm:col-span-2">
          <button type="submit" class="btn btn-primary" [disabled]="busy()">
            Crear invitación
          </button>
        </div>
      </form>

      @if (formError(); as message) {
        <p role="alert" class="mt-3 rounded-lg bg-danger/10 p-3 text-sm text-text">{{ message }}</p>
      }

      @if (created(); as c) {
        <div class="mt-4 rounded-lg border border-border-strong p-4" data-testid="new-link">
          <p class="font-semibold">Link de invitación</p>
          <p data-testid="link-warning" class="mt-1 text-sm text-text">
            Copialo ahora: por seguridad no lo vamos a mostrar de nuevo.
          </p>
          <input
            #linkField
            class="field mt-3 w-full"
            readonly
            aria-label="Link de invitación"
            [value]="c.url"
          />
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" class="btn btn-primary" (click)="copy(c.url)">Copiar link</button>
            <a class="btn" [href]="c.whatsappUrl" target="_blank" rel="noopener noreferrer"
              >Compartir por WhatsApp</a
            >
            <button type="button" class="btn" (click)="dismiss()">Ya lo copié</button>
          </div>
        </div>
      }
      <p role="status" class="mt-2 min-h-5 text-sm text-text">{{ notice() }}</p>

      <h3 class="mt-4 text-base font-semibold">Enviadas</h3>
      @if (loadError(); as message) {
        <p role="alert" class="mt-2 rounded-lg bg-danger/10 p-3 text-sm text-text">{{ message }}</p>
      } @else if (list(); as rows) {
        @if (rows.length === 0) {
          <p class="mt-2 text-sm text-text-muted" data-testid="no-invitations">
            Todavía no invitaste a nadie. Creá una invitación y compartila: el feriante la acepta
            con su cuenta de Google ("Ingresar con Google").
          </p>
        } @else {
          <ul class="mt-2 divide-y divide-border">
            @for (i of rows; track i.id) {
              <li class="flex flex-wrap items-center gap-3 py-2" data-testid="invitation-row">
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium">{{
                    i.email ?? 'Cualquier cuenta de Google'
                  }}</span>
                  <span class="block truncate text-xs text-text-muted"
                    >{{ i.name ? i.name + ' · ' : '' }}Creada {{ day(i.createdAt) }} · Vence
                    {{ day(i.expiresAt) }}</span
                  >
                </span>
                <span
                  class="shrink-0 rounded-full px-2 py-0.5 text-xs text-text"
                  [class]="status[i.status].tone"
                >
                  <span aria-hidden="true">{{ status[i.status].icon }}</span>
                  {{ status[i.status].label }}
                </span>
                @if (i.status === 'PENDING') {
                  <button
                    type="button"
                    class="btn btn-danger"
                    data-revoke
                    [disabled]="busy() || revoking() !== null"
                    (click)="askRevoke(i)"
                  >
                    Revocar
                  </button>
                }
              </li>
            }
          </ul>
        }
      } @else {
        <p class="mt-2 text-sm text-text-muted" data-testid="loading-invitations">
          Cargando invitaciones…
        </p>
      }

      @if (revoking(); as target) {
        <div
          role="alertdialog"
          aria-labelledby="revoke-title"
          aria-describedby="revoke-text"
          class="mt-4 rounded-lg border border-border-strong p-4"
        >
          <p id="revoke-title" class="font-semibold">¿Revocar la invitación?</p>
          <p id="revoke-text" class="mt-1 text-sm text-text-muted">
            El link de {{ target.email ?? 'esta invitación' }} deja de funcionar y no se puede
            deshacer.
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-danger"
              [disabled]="busy()"
              (click)="revoke(target)"
            >
              Sí, revocar
            </button>
            <button #cancel type="button" class="btn" (click)="revoking.set(null)">Cancelar</button>
          </div>
        </div>
      }
    </section>
  `,
})
export class InvitationsPanel {
  private readonly repository = inject(InvitationRepository);
  private readonly injector = inject(Injector);
  private readonly cancel = viewChild<ElementRef<HTMLButtonElement>>('cancel');
  private readonly linkField = viewChild<ElementRef<HTMLInputElement>>('linkField');

  protected readonly status = STATUS;
  protected readonly expiryDays = EXPIRY_DAYS;
  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly phone = signal('');
  protected readonly expiresInDays = signal(7);
  protected readonly list = signal<readonly InvitationDto[] | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly notice = signal('');
  protected readonly busy = signal(false);
  protected readonly created = signal<CreatedInvitationDto | null>(null);
  protected readonly revoking = signal<InvitationDto | null>(null);

  constructor() {
    this.load();
  }

  protected create(event: Event): void {
    event.preventDefault();
    const email = this.email().trim();
    if (email && !EMAIL_SHAPE.test(email)) {
      this.formError.set(BAD_EMAIL);
      return;
    }
    const name = this.name().trim();
    const phone = this.phone().trim();
    this.formError.set(null);
    this.notice.set('');
    this.busy.set(true);
    this.repository
      .create({
        ...(email && { email }),
        ...(name && { name }),
        ...(phone && { phone }),
        expiresInDays: this.expiresInDays(),
      })
      .subscribe({
        next: (invitation) => {
          this.busy.set(false);
          this.created.set(invitation);
          this.name.set('');
          this.email.set('');
          this.phone.set('');
          this.load();
        },
        error: () => {
          this.busy.set(false);
          this.formError.set(CREATE_FAILED);
        },
      });
  }

  protected async copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.notice.set('Link copiado.');
    } catch {
      const field = this.linkField()?.nativeElement;
      field?.focus();
      field?.select();
      this.notice.set(
        'Seleccionamos el link: copialo con Ctrl+C (o mantené apretado en el celular).',
      );
    }
  }

  protected dismiss(): void {
    this.created.set(null);
    this.notice.set('');
  }

  protected askRevoke(invitation: InvitationDto): void {
    this.revoking.set(invitation);
    afterNextRender(() => this.cancel()?.nativeElement.focus(), { injector: this.injector });
  }

  protected revoke(invitation: InvitationDto): void {
    this.busy.set(true);
    this.repository.revoke(invitation.id).subscribe({
      next: () => this.afterRevoke(null),
      error: () => this.afterRevoke(REVOKE_FAILED),
    });
  }

  protected day(iso: string): string {
    return new Date(iso).toLocaleDateString('es-AR');
  }

  protected valueOf(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }

  private afterRevoke(problem: string | null): void {
    this.busy.set(false);
    this.revoking.set(null);
    this.formError.set(problem);
    this.load();
  }

  private load(): void {
    this.repository.list().subscribe({
      next: (rows) => {
        this.loadError.set(null);
        this.list.set(rows);
      },
      error: () => this.loadError.set(LOAD_FAILED),
    });
  }
}
