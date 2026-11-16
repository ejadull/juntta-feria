import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('renders only the router outlet (no starter placeholder)', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('router-outlet')).not.toBeNull();
    expect(host.querySelector('h1')).toBeNull();
  });

  it('starts with a skip link that moves focus to <main>', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    const main = document.createElement('main');
    main.id = 'main';
    document.body.appendChild(main);
    const link = host.firstElementChild as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.textContent?.trim()).toBe('Saltar al contenido');
    link.click();
    expect(document.activeElement).toBe(main);
    host.remove();
    main.remove();
  });
});
