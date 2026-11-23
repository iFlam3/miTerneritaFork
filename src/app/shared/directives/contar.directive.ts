import { DestroyRef, Directive, effect, ElementRef, inject, input } from '@angular/core';

/**
 * Muestra un número entero que sube (o baja) hasta su valor en ~0,6 s.
 * Uso: <strong [appContar]="total()"></strong>
 */
@Directive({ selector: '[appContar]' })
export class ContarDirective {
  private el = inject<ElementRef<HTMLElement>>(ElementRef);
  appContar = input.required<number>();
  private actual = 0;
  private frame = 0;

  constructor() {
    effect(() => this.animar(Number(this.appContar()) || 0));
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.frame));
  }

  private animar(destino: number) {
    cancelAnimationFrame(this.frame);
    const desde = this.actual;
    const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (quieto || desde === destino) return this.pintar(destino);
    const inicio = performance.now();
    const paso = (t: number) => {
      const p = Math.min(1, (t - inicio) / 600);
      const suave = 1 - Math.pow(1 - p, 3);
      this.pintar(Math.round(desde + (destino - desde) * suave));
      if (p < 1) this.frame = requestAnimationFrame(paso);
    };
    this.frame = requestAnimationFrame(paso);
  }

  private pintar(n: number) {
    this.actual = n;
    this.el.nativeElement.textContent = String(n);
  }
}
