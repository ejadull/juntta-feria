import { TestBed } from '@angular/core/testing';
import { EditorToolbar } from './editor-toolbar';

type State = Partial<Record<'canUndo' | 'canRedo' | 'canPublish' | 'isDirty' | 'busy', boolean>>;

async function setup(state: State = {}) {
  const fixture = TestBed.createComponent(EditorToolbar);
  const inputs = {
    canUndo: false,
    canRedo: true,
    canPublish: false,
    isDirty: true,
    busy: false,
    ...state,
  };
  fixture.componentRef.setInput('step', 0.5);
  Object.entries(inputs).forEach(([k, v]) => fixture.componentRef.setInput(k, v));
  const events: unknown[] = [];
  const c = fixture.componentInstance;
  c.add.subscribe((k) => events.push(['add', k]));
  c.stepChange.subscribe((s) => events.push(['step', s]));
  c.undo.subscribe(() => events.push('undo'));
  c.redo.subscribe(() => events.push('redo'));
  c.save.subscribe(() => events.push('save'));
  c.publish.subscribe(() => events.push('publish'));
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;
  const select = (label: string) =>
    host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  return { host, button, select, events };
}

function choose(el: HTMLSelectElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('change'));
}

describe('EditorToolbar', () => {
  it('disables Publicar while there are errors and explains why', async () => {
    const { button } = await setup({ canPublish: false });
    expect(button('Publicar').disabled).toBe(true);
    expect(button('Publicar').getAttribute('title')).toContain('Corregí');
  });

  it('enables Publicar when publishable and emits on click', async () => {
    const { button, events } = await setup({ canPublish: true });
    expect(button('Publicar').disabled).toBe(false);
    button('Publicar').click();
    expect(events).toEqual(['publish']);
  });

  it('reflects undo/redo availability', async () => {
    const { button, events } = await setup({ canUndo: false, canRedo: true });
    expect(button('Deshacer').disabled).toBe(true);
    button('Rehacer').click();
    expect(events).toEqual(['redo']);
  });

  it('adds the chosen kind (stand by default)', async () => {
    const { button, select, events } = await setup();
    button('Agregar').click();
    choose(select('Tipo a agregar'), 'AISLE');
    button('Agregar').click();
    expect(events).toEqual([
      ['add', 'STAND'],
      ['add', 'AISLE'],
    ]);
  });

  it('changes the snap step', async () => {
    const { select, events } = await setup();
    expect(select('Paso de snap').value).toBe('0.5');
    choose(select('Paso de snap'), '1');
    expect(events).toEqual([['step', 1]]);
  });

  it('saves only with pending changes and blocks actions while busy', async () => {
    expect((await setup({ isDirty: false })).button('Guardar').disabled).toBe(true);
    TestBed.resetTestingModule();
    const busy = await setup({ isDirty: true, canPublish: true, busy: true });
    expect(busy.button('Guardar').disabled).toBe(true);
    expect(busy.button('Publicar').disabled).toBe(true);
  });
});
