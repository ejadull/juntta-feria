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
import { AREA_HOME } from '../../shared/auth/area';
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

const OFFLINE = 'No pudimos conectar con el servidor. Revisá tu conexión y probá de nuevo.';

const ACCEPT_ERRORS: Readonly<Record<string, string>> = {
  INVITATION_EMAIL_MISMATCH:
    'La cuenta de Google tiene otro email que el de la invitación. Elegí la cuenta con el email invitado.',
  GOOGLE_CREDENTIAL_INVALID: 'No pudimos verificar tu cuenta de Google. Probá de nuevo.',
  GOOGLE_SIGN_IN_UNAVAILABLE:
    'Continuar con Google no está disponible por ahora. Probá de nuevo en unos minutos.',
};
const ACCEPT_STATUS: Readonly<Record<number, string>> = {
  404: 'Este link de invitación no es válido, venció o ya se usó. Pedile uno nuevo al organizador.',
  409: 'Ya hay una cuenta con ese email. Ingresá con tu cuenta en lugar de crear otra.',
  503: 'No está disponible por un momento. Probá de nuevo en unos minutos.',
};
const SIGN_IN_AFTER_ACCEPT =
  'Tu cuenta quedó creada, pero no pudimos ingresarte. Entrá desde la pantalla de ingreso.';

/** P20 (EXH-04): whoever holds the invitation link creates the exhibitor account, with Google. */
@Component({
  selector: 'app-invitation-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GoogleSignInButton, RouterLink],
  template: `
    <section class="mx-auto max-w-md px-4 py-10 sm:px-6">
      <p class="text-sm font-semibold tracking-wider text-primary-strong">INVITACIÓN</p>

      @if (status() === 'loading') {
        <h1 class="mt-1 text-3xl font-semibold">Abriendo tu invitación…</h1>
      } @else if (status() === 'invalid') {
        <h1 class="mt-1 text-3xl font-semibold">Este link no sirve</h1>
        <p class="mt-2 text-text-muted" role="alert">{{ invalidMessage }}</p>
        <a class="btn mt-6" routerLink="/ingresar">Ir a ingresar</a>
      } @else if (invitation(); as inv) {
        <h1 class="mt-1 text-3xl font-semibold">Creá tu cuenta de feriante</h1>
        <p class="mt-2 text-text-muted">
          {{ inv.organizationName }} te invitó a sumarte como feriante. Continuá con tu cuenta de
          Google.
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
        } @else if (googleClientId() === null) {
          <p role="alert" class="mt-6 rounded-lg bg-danger/10 p-3 text-sm">
            {{ unavailable }}
          </p>
        }

        @if (error(); as message) {
          <p id="invitation-error" role="alert" class="mt-4 rounded-lg bg-danger/10 p-3 text-sm">
            {{ message }}
          </p>
        }
      }
    </section>
  `,
})
export class InvitationPage implements OnInit {
  /** Route param `:token` (withComponentInputBinding). */
  readonly token = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** Undefined while the API answers; null when Google sign-in is not configured. */
  protected readonly googleClientId = toSignal(inject(AuthProviders).googleClientId$);
  protected readonly unavailable = ACCEPT_ERRORS['GOOGLE_SIGN_IN_UNAVAILABLE'];
  protected readonly invalidMessage = ACCEPT_STATUS[404];
  protected readonly invitation = signal<InvitationDto | null>(null);
  protected readonly loaded = signal(false);
  protected readonly status = computed(() =>
    this.invitation() ? 'ready' : this.loaded() ? 'invalid' : 'loading',
  );
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    const sub = this.http
      .get<InvitationDto>(`${API_BASE}/public/invitations/${encodeURIComponent(this.token())}`)
      .subscribe({
        next: (invitation) => {
          this.invitation.set(invitation);
          this.loaded.set(true);
        },
        error: () => this.loaded.set(true),
      });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  /** Accepts with the Google ID token, then signs the new account in with the same token. */
  protected acceptWithGoogle(credential: string): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.http
      .post(`${API_BASE}/public/invitations/${encodeURIComponent(this.token())}/accept`, {
        googleCredential: credential,
      })
      // The ID token is still valid and the account now exists: signing in with it is one more call.
      .pipe(switchMap(() => this.session.loginWithGoogle(credential)))
      .subscribe({
        next: () => void this.router.navigateByUrl(AREA_HOME[this.session.area()]),
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
