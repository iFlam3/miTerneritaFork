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
   * Cambia el tema al instante. Antes había un revelado circular (View Transition) y luego
   * un fundido: capturar y animar toda la página iba a tirones en equipos modestos y subía
   * el INP. Durante el cambio se apagan las transiciones para que nada se anime de a poco.
   */
  toggle() {
    const root = this.document.documentElement;
    root.classList.add('theme-swap');
    this.apply(this.isDark() ? 'light' : 'dark');
    // Fuerza el estilo nuevo sin transiciones y las vuelve a activar en el siguiente fotograma.
    void root.offsetWidth;
    requestAnimationFrame(() => root.classList.remove('theme-swap'));
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
