import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import { API_BASE } from '../../shared/api/api-base';
import { AuthProviders } from '../../shared/auth/auth-providers';
import { problemOf, messageFor } from '../../shared/auth/problem';
import { SessionStore } from '../../shared/auth/session.store';
import { GoogleSignInButton } from '../../shared/google-sign-in';

/** `GET /public/invitations/:token` (EXH-04). */
interface InvitationDto {
  readonly organizationName: string;
  readonly email: string | null;
  readonly name: string | null;
}

const MIN_PASSWORD = 10;
const OFFLINE = 'No pudimos conectar con el servidor. Revisá tu conexión y probá de nuevo.';

const ACCEPT_ERRORS: Readonly<Record<string, string>> = {
  INVITATION_EMAIL_MISMATCH:
    'La cuenta de Google tiene otro email que el de la invitación. Elegí la cuenta con el email invitado.',
  GOOGLE_CREDENTIAL_INVALID: 'No pudimos verificar tu cuenta de Google. Probá de nuevo.',
  GOOGLE_SIGN_IN_UNAVAILABLE:
    'Continuar con Google no está disponible por ahora. Creá tu cuenta con una contraseña.',
};
const ACCEPT_STATUS: Readonly<Record<number, string>> = {
  400: 'Revisá los datos: el nombre, el email y una contraseña de al menos 10 caracteres.',
  404: 'Este link de invitación no es válido, venció o ya se usó. Pedile uno nuevo al organizador.',
  409: 'Ya hay una cuenta con ese email. Ingresá con tu cuenta en lugar de crear otra.',
  503: 'No está disponible por un momento. Probá de nuevo en unos minutos.',
};
const SIGN_IN_AFTER_ACCEPT =
  'Tu cuenta quedó creada, pero no pudimos ingresarte. Entrá desde la pantalla de ingreso.';

const valueOf = (event: Event): string => (event.target as HTMLInputElement).value;

/** P20 (EXH-04): whoever holds the invitation link creates the exhibitor account. */
@Component({
  selector: 'app-invitation-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GoogleSignInButton, RouterLink],
  template: `
    <section class="mx-auto max-w-md px-4 py-10 sm:px-6">
      <p class="text-sm font-semibold tracking-wider text-primary">INVITACIÓN</p>

      @if (status() === 'loading') {
        <h1 class="mt-1 text-3xl font-semibold">Abriendo tu invitación…</h1>
      } @else if (status() === 'invalid') {
        <h1 class="mt-1 text-3xl font-semibold">Este link no sirve</h1>
        <p class="mt-2 text-text-muted" role="alert">{{ invalidMessage }}</p>
        <a class="btn mt-6" routerLink="/ingresar">Ir a ingresar</a>
      } @else if (invitation(); as inv) {
        <h1 class="mt-1 text-3xl font-semibold">Creá tu cuenta de feriante</h1>
        <p class="mt-2 text-text-muted">
          {{ inv.organizationName }} te invitó a sumarte como feriante.
        </p>

        @if (googleClientId(); as clientId) {
          <div class="mt-6">
            <app-google-sign-in-button
              [clientId]="clientId"
              text="continue_with"
              label="Continuar con Google"
              (credential)="acceptWithGoogle($event)"
            />
          </div>
          <div class="mt-6 flex items-center gap-3 text-sm text-text-muted" aria-hidden="true">
            <span class="h-px flex-1 bg-border-strong"></span>
            <span>o creá una contraseña</span>
            <span class="h-px flex-1 bg-border-strong"></span>
          </div>
        }

        <form
          class="card mt-6 flex flex-col gap-4"
          (submit)="acceptWithPassword($event)"
          novalidate
        >
          <div class="flex flex-col gap-1">
            <label for="fullName" class="text-sm font-medium">Nombre y apellido</label>
            <input
              id="fullName"
              name="fullName"
              autocomplete="name"
              class="field"
              [value]="fullName()"
              (input)="fullName.set(valueOf($event))"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="email" class="text-sm font-medium">Correo electrónico</label>
            <input
              id="email"
              name="email"
              type="email"
              autocomplete="username"
              class="field"
              [readOnly]="!!inv.email"
              [value]="email()"
              (input)="email.set(valueOf($event))"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="password" class="text-sm font-medium">Contraseña</label>
            <input
              id="password"
              name="password"
              type="password"
              autocomplete="new-password"
              aria-describedby="password-hint"
              class="field"
              [value]="password()"
              (input)="password.set(valueOf($event))"
            />
            <p id="password-hint" class="text-xs text-text-muted">Al menos 10 caracteres.</p>
          </div>
          <div class="flex flex-col gap-1">
            <label for="phone" class="text-sm font-medium">Teléfono (opcional)</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              autocomplete="tel"
              class="field"
              [value]="phone()"
              (input)="phone.set(valueOf($event))"
            />
          </div>

          @if (error(); as message) {
            <p id="invitation-error" role="alert" class="rounded-lg bg-danger/10 p-3 text-sm">
              {{ message }}
            </p>
          }

          <button type="submit" class="btn btn-primary justify-center" [disabled]="busy()">
            {{ busy() ? 'Creando tu cuenta…' : 'Crear cuenta' }}
          </button>
        </form>
      }
    </section>
  `,
  styles: `
    .field {
      min-height: 2.75rem;
      padding: 0 0.75rem;
      border: 1px solid var(--color-border-strong);
      border-radius: 0.5rem;
      background: var(--color-surface);
      color: var(--color-text);
    }
    .field:focus-visible {
      outline: 2px solid var(--color-selected);
      outline-offset: 1px;
    }
  `,
})
export class InvitationPage implements OnInit {
  /** Route param `:token` (withComponentInputBinding). */
  readonly token = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly googleClientId = toSignal(inject(AuthProviders).googleClientId$, {
    initialValue: null,
  });
  protected readonly valueOf = valueOf;
  protected readonly invalidMessage = ACCEPT_STATUS[404];
  protected readonly invitation = signal<InvitationDto | null>(null);
  protected readonly loaded = signal(false);
  protected readonly status = computed(() =>
    this.invitation() ? 'ready' : this.loaded() ? 'invalid' : 'loading',
  );
  protected readonly fullName = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly phone = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    const sub = this.http
      .get<InvitationDto>(`${API_BASE}/public/invitations/${encodeURIComponent(this.token())}`)
      .subscribe({
        next: (invitation) => {
          this.invitation.set(invitation);
          this.fullName.set(invitation.name ?? '');
          this.email.set(invitation.email ?? '');
          this.loaded.set(true);
        },
        error: () => this.loaded.set(true),
      });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  protected acceptWithPassword(event: Event): void {
    event.preventDefault();
    if (this.busy()) return;
    const email = this.email().trim();
    const fullName = this.fullName().trim();
    if (!fullName || !email || this.password().length < MIN_PASSWORD) {
      this.error.set(ACCEPT_STATUS[400]);
      return;
    }
    const password = this.password();
    this.run({ fullName, email, password, ...this.phoneField() }, () =>
      this.session.login(email, password),
    );
  }

  protected acceptWithGoogle(credential: string): void {
    if (this.busy()) return;
    const fullName = this.fullName().trim();
    this.run(
      { googleCredential: credential, ...(fullName ? { fullName } : {}), ...this.phoneField() },
      // The ID token is still valid and the account now exists: signing in with it is one more call.
      () => this.session.loginWithGoogle(credential),
    );
  }

  private phoneField(): { phone?: string } {
    const phone = this.phone().trim();
    return phone ? { phone } : {};
  }

  /** Accepts the invitation with `body`, then signs the new account in and enters the exhibitor area. */
  private run(body: object, signIn: () => ReturnType<SessionStore['login']>): void {
    this.busy.set(true);
    this.error.set(null);
    this.http
      .post(`${API_BASE}/public/invitations/${encodeURIComponent(this.token())}/accept`, body)
      .pipe(switchMap(() => signIn()))
      .subscribe({
        next: () => void this.router.navigateByUrl('/feriante/explorar'),
        error: (e: unknown) => {
          this.busy.set(false);
          // A 401 without a code after a successful accept is the sign-in, not a bad credential.
          const { status, code } = problemOf(e);
          this.error.set(
            status === 401 && !code
              ? SIGN_IN_AFTER_ACCEPT
              : messageFor(e, ACCEPT_ERRORS, ACCEPT_STATUS, OFFLINE),
          );
        },
      });
  }
}
