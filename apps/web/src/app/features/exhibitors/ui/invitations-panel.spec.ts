import { TestBed } from '@angular/core/testing';
import { Subject, throwError } from 'rxjs';
import { InMemoryInvitationRepository } from '../data/in-memory-invitation.repository';
import { InvitationRepository, type InvitationDto } from '../data/invitation.repository';
import { InvitationsPanel } from './invitations-panel';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const row = (patch: Partial<InvitationDto> = {}): InvitationDto => ({
  id: 'i1',
  email: 'ana@example.test',
  phone: null,
  name: null,
  status: 'PENDING',
  expiresAt: '2026-11-20T12:00:00Z',
  acceptedAt: null,
  createdAt: '2026-11-10T12:00:00Z',
  ...patch,
});

async function render(repo: InvitationRepository = new InMemoryInvitationRepository()) {
  TestBed.configureTestingModule({
    providers: [{ provide: InvitationRepository, useValue: repo }],
  });
  const fixture = TestBed.createComponent(InvitationsPanel);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const button = (label: string) =>
    [...host.querySelectorAll('button')].find((b) => plain(b.textContent).includes(label))!;
  const click = async (label: string) => {
    button(label).click();
    await fixture.whenStable();
  };
  const fill = async (label: string, value: string) => {
    const input = host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  return { fixture, host, button, click, fill };
}

describe('InvitationsPanel (EXH-04, organizador)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('explains the empty state', async () => {
    const { host } = await render();
    expect(host.querySelector('[data-testid="no-invitations"]')).not.toBeNull();
    expect(host.textContent).toContain('Ingresar con Google');
  });

  it('says what the optional email does', async () => {
    const { host } = await render();
    expect(plain(host.textContent)).toContain('solo esa cuenta de Google');
  });

  it('shows a loading note until the list arrives', async () => {
    const repo = new InMemoryInvitationRepository();
    const pending = new Subject<readonly InvitationDto[]>();
    repo.list = () => pending;
    const { host, fixture } = await render(repo);
    expect(host.querySelector('[data-testid="loading-invitations"]')).not.toBeNull();
    pending.next([]);
    await fixture.whenStable();
    expect(host.querySelector('[data-testid="loading-invitations"]')).toBeNull();
  });

  it('shows the link once, with the warning, after inviting', async () => {
    const { host, click, fill } = await render();
    await fill('Email', 'ana@example.test');
    await click('Crear invitación');
    const link = host.querySelector<HTMLInputElement>('input[readonly]')!;
    expect(link.value).toMatch(/^https:\/\/feria\.test\/invitacion\//);
    expect(host.querySelector('[data-testid="link-warning"]')?.textContent).toContain(
      'no lo vamos a mostrar de nuevo',
    );
    const whatsapp = host.querySelector<HTMLAnchorElement>('a[href^="https://wa.me/"]')!;
    expect(whatsapp.textContent).toContain('Compartir por WhatsApp');
    expect(whatsapp.target).toBe('_blank');
    expect(whatsapp.rel).toContain('noopener');
    expect(host.querySelector('[data-testid="invitation-row"]')?.textContent).toContain(
      'Pendiente',
    );
  });

  it('hides the link when dismissed', async () => {
    const { host, click } = await render();
    await click('Crear invitación');
    await click('Ya lo copié');
    expect(host.querySelector('input[readonly]')).toBeNull();
  });

  it('copies the link and announces it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { host, click, fixture } = await render();
    await click('Crear invitación');
    await click('Copiar link');
    await fixture.whenStable();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/invitacion/'));
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Link copiado');
  });

  it('asks to copy by hand when the clipboard is not available', async () => {
    vi.stubGlobal('navigator', {});
    const { host, click, fixture } = await render();
    await click('Crear invitación');
    await click('Copiar link');
    await fixture.whenStable();
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Seleccionamos el link');
  });

  it('lists every status with its label and email, and revokes only pending ones', async () => {
    const repo = new InMemoryInvitationRepository([
      row({ id: 'a', status: 'PENDING' }),
      row({ id: 'b', status: 'ACCEPTED', email: null, acceptedAt: '2026-11-11T12:00:00Z' }),
      row({ id: 'c', status: 'EXPIRED' }),
      row({ id: 'd', status: 'REVOKED' }),
    ]);
    const { host } = await render(repo);
    const text = plain(host.textContent);
    for (const label of ['Pendiente', 'Usada', 'Vencida', 'Revocada'])
      expect(text).toContain(label);
    expect(text).toContain('ana@example.test');
    expect(text).toContain('Cualquier cuenta de Google');
    expect(host.querySelectorAll('button[data-revoke]')).toHaveLength(1);
  });

  it('revokes a pending invitation after an in-page confirmation', async () => {
    const { host, click } = await render(new InMemoryInvitationRepository([row({ id: 'a' })]));
    await click('Revocar');
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
    await click('Sí, revocar');
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(host.querySelector('[data-testid="invitation-row"]')?.textContent).toContain('Revocada');
    expect(host.querySelector('button[data-revoke]')).toBeNull();
  });

  it('keeps the invitation when the confirmation is cancelled', async () => {
    const { host, click } = await render(new InMemoryInvitationRepository([row({ id: 'a' })]));
    await click('Revocar');
    await click('Cancelar');
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(host.querySelector('[data-testid="invitation-row"]')?.textContent).toContain(
      'Pendiente',
    );
  });

  it('says so when the list cannot load', async () => {
    const repo = new InMemoryInvitationRepository();
    repo.list = () => throwError(() => ({ status: 500 }));
    const { host } = await render(repo);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'No pudimos cargar las invitaciones',
    );
  });

  it('says so when creating fails and shows no link', async () => {
    const repo = new InMemoryInvitationRepository();
    repo.create = () => throwError(() => ({ status: 400 }));
    const { host, click } = await render(repo);
    await click('Crear invitación');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'No pudimos crear la invitación',
    );
    expect(host.querySelector('input[readonly]')).toBeNull();
  });

  it('rejects a malformed email before calling the API', async () => {
    const repo = new InMemoryInvitationRepository();
    const create = vi.spyOn(repo, 'create');
    const { host, click, fill } = await render(repo);
    await fill('Email', 'sin-arroba');
    await click('Crear invitación');
    expect(create).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('email válido');
  });
});
