import { DOCUMENT } from '@angular/common';
import { inject, Injectable, signal } from '@angular/core';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'tm-theme';
const THEME_COLOR: Record<Theme, string> = { dark: '#0A0A0C', light: '#F6F4EF' };

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private document = inject(DOCUMENT);

  /** Tema activo. El script de index.html ya lo aplicó antes del primer pintado. */
  readonly theme = signal<Theme>(this.readInitial());

  constructor() {
    this.apply(this.theme());
  }

  isDark() {
    return this.theme() === 'dark';
  }

  /**
   * Cambia el tema al instante y lo suaviza con un velo del color anterior que se desvanece.
   * Antes había un revelado circular (View Transition): capturar y animar toda la página iba
   * a tirones en equipos modestos y subía el INP. El velo es una sola capa que solo anima su
   * opacidad (la hace la GPU). Durante el cambio se apagan las transiciones de la página.
   */
  toggle() {
    const root = this.document.documentElement;
    this.velo(getComputedStyle(root).getPropertyValue('--bg').trim());
    root.classList.add('theme-swap');
    this.apply(this.isDark() ? 'light' : 'dark');
    // Fuerza el estilo nuevo sin transiciones y las vuelve a activar en el siguiente fotograma.
    void root.offsetWidth;
    requestAnimationFrame(() => root.classList.remove('theme-swap'));
  }

  private velo(color: string) {
    const win = this.document.defaultView;
    if (!color || !win || this.document.visibilityState !== 'visible' || win.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const velo = this.document.createElement('div');
    velo.setAttribute('aria-hidden', 'true');
    velo.style.cssText = `position:fixed;inset:0;z-index:2147483647;pointer-events:none;background:${color}`;
    this.document.body.appendChild(velo);
    velo.animate({ opacity: [1, 0] }, { duration: 260, easing: 'ease-out', fill: 'forwards' });
    // Con temporizador y no con .finished: si el navegador pausa la animación, el velo no se queda.
    win.setTimeout(() => velo.remove(), 400);
  }

  private apply(theme: Theme) {
    const root = this.document.documentElement;
    root.setAttribute('data-theme', theme);
    root.classList.toggle('app-dark', theme === 'dark');
    this.document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
    this.theme.set(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // almacenamiento no disponible (modo privado): el tema dura solo esta sesión
    }
  }

  private readInitial(): Theme {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  }
}
