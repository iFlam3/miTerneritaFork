import { Component, computed, effect, inject, Input, OnDestroy, OnInit, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { LoadingService } from '../../services/loading.service';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';
import { Subscription } from 'rxjs';

/** Segundos que suele tardar el peor caso: el back gratis de Render despertando (~50 s). */
const ESPERA_ESTIMADA_S = 60;

/**
 * Tiempos de carga: menos de 1 s no se muestra nada; de 1 a 10 s, esqueleto
 * (o la barra fina al navegar); más de 10 s, progreso y tiempo restante.
 * - mode="window": loader global. Splash de marca solo en la primera carga,
 *   barra fina al navegar y aviso de progreso si algo tarda más de 10 s.
 * - mode="component" (por defecto): esqueleto en línea para tablas/listas.
 */
@Component({
  selector: 'app-loader',
  imports: [DecimalPipe],
  templateUrl: './loader.component.html',
  styleUrl: './loader.component.scss'
})
export class LoaderComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private routerSub?: Subscription;
  private doneTimer?: ReturnType<typeof setTimeout>;

  @Input() isLoading: boolean = false;
  @Input() mode: 'window' | 'component' = 'component';
  /** Filas del esqueleto en línea. */
  @Input() set rows(n: number) { this.filas = Array.from({ length: n }, (_, i) => i); }
  filas = [0, 1, 2, 3, 4];

  splash = signal(true);
  navigating = signal(false);
  /** Hay peticiones a la API hace más de 1 s (las rápidas no muestran nada). */
  fetching = signal(false);
  private fetchTimer?: ReturnType<typeof setTimeout>;
  private loading = inject(LoadingService);
  private ahora = signal(Date.now());
  private reloj?: ReturnType<typeof setInterval>;

  /** Segundos de espera, solo pasados 10 s. */
  readonly lento = computed(() => {
    const desde = this.loading.desde();
    const s = desde === null ? 0 : Math.floor((this.ahora() - desde) / 1000);
    return s > 10 ? s : 0;
  });
  // shortcut: el tiempo restante es una estimacion fija (ESPERA_ESTIMADA_S); la API no informa progreso real.
  readonly progreso = computed(() => Math.min(95, (this.lento() / ESPERA_ESTIMADA_S) * 100));
  readonly restante = computed(() => {
    const quedan = ESPERA_ESTIMADA_S - this.lento();
    return quedan > 0 ? `Quedan unos ${quedan} s` : 'Está tardando más de lo normal';
  });

  constructor() {
    effect(() => {
      clearTimeout(this.fetchTimer);
      clearInterval(this.reloj);
      if (this.loading.pending() > 0) {
        this.fetchTimer = setTimeout(() => this.fetching.set(true), 1000);
        if (this.mode === 'window') this.reloj = setInterval(() => this.ahora.set(Date.now()), 1000);
      } else {
        this.fetching.set(false);
      }
    });
  }

  ngOnInit() {
    if (this.mode === 'window') {
      this.listenToRouter();
    }
  }

  private listenToRouter() {
    this.routerSub = this.router.events.subscribe(event => {
      if (event instanceof NavigationStart) {
        clearTimeout(this.doneTimer);
        this.navigating.set(true);
      }
      if (event instanceof NavigationEnd || event instanceof NavigationCancel || event instanceof NavigationError) {
        this.doneTimer = setTimeout(() => {
          this.navigating.set(false);
          this.splash.set(false);
        }, this.splash() ? 450 : 200);
      }
    });
  }

  ngOnDestroy() {
    this.routerSub?.unsubscribe();
    clearTimeout(this.doneTimer);
    clearTimeout(this.fetchTimer);
    clearInterval(this.reloj);
  }
}
