import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { HoverPreloading, routeMatches, segmentsOf } from './hover-preloading';

describe('hover preloading', () => {
  it('reads same-origin link segments and ignores other origins', () => {
    expect(segmentsOf('http://app.test/organizador/panel?x=1', 'http://app.test')).toEqual([
      'organizador',
      'panel',
    ]);
    expect(segmentsOf('https://www.mercadopago.com.ar/x', 'http://app.test')).toBeNull();
  });

  it('matches a route path, with params, inside the link', () => {
    expect(routeMatches('panel', ['organizador', 'panel'])).toBe(true);
    expect(routeMatches('eventos/:id', ['organizador', 'eventos', 'e1'])).toBe(true);
    expect(routeMatches('predios', ['organizador', 'panel'])).toBe(false);
    expect(routeMatches(':id', ['organizador', 'predios'])).toBe(false);
  });

  it('loads a lazy route only after a link to it is hovered', () => {
    const strategy = TestBed.inject(HoverPreloading);
    let loaded = 0;
    strategy.preload({ path: 'panel' }, () => of(++loaded)).subscribe();

    const other = document.createElement('a');
    other.href = '/organizador/predios';
    const link = document.createElement('a');
    link.href = '/organizador/panel';
    document.body.append(other, link);

    other.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(loaded).toBe(0);
    link.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(loaded).toBe(1);
    link.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(loaded).toBe(1);
    other.remove();
    link.remove();
  });
});
