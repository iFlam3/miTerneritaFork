import { DecimalPipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ChartModule } from 'primeng/chart';
import { SelectButtonModule } from 'primeng/selectbutton';
import { catchError, interval, of, startWith, switchMap, tap } from 'rxjs';
import { ResumenVisitas, VisitasService } from '../../../../@core/services/visitas.service';
import { ThemeService } from '../../../../@core/services/theme.service';

/** Cada cuánto se refresca "en línea ahora". */
const REFRESCO_ACTIVAS_MS = 30_000;
const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
/** Pasos que se muestran en el embudo (consumo es opcional y lo descuadraría). */
const EMBUDO: Record<string, string> = {
  evento: 'Vieron un evento',
  entradas: 'Eligieron entradas',
  datos: 'Llenaron sus datos',
  pago: 'Llegaron al pago',
  pagado: 'Enviaron el pago'
};

/** 0 → "12 am", 13 → "1 pm". */
export const hora12 = (h: number) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;

/** Segundos legibles: "45 s", "4 min 12 s", "2 h 05 min", "3 d 4 h". */
export function duracion(seg: number | null | undefined): string {
  if (seg === null || seg === undefined) return '—';
  if (seg < 60) return `${Math.round(seg)} s`;
  const min = Math.floor(seg / 60);
  if (min < 10) return `${min} min ${Math.round(seg % 60)} s`;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${String(min % 60).padStart(2, '0')} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/**
 * Visitas del sitio público: en línea ahora, cuándo se conectan (por día, por
 * hora y mapa de calor), dispositivos, embudo de compra, cuánto tarda un
 * cliente en comprar y cuánto espera a que se verifique su pago.
 */
@Component({
  selector: 'app-visitas-panel',
  imports: [ChartModule, DecimalPipe, FormsModule, RouterLink, SelectButtonModule],
  templateUrl: './visitas-panel.component.html',
  styleUrl: './visitas-panel.component.scss'
})
export class VisitasPanelComponent {
  private visitasService = inject(VisitasService);
  private theme = inject(ThemeService);

  readonly rangos = [
    { label: 'Hoy', value: 1 },
    { label: '7 días', value: 7 },
    { label: '30 días', value: 30 },
    { label: '90 días', value: 90 }
  ];
  readonly diasSemana = DIAS_SEMANA;
  readonly horas = Array.from({ length: 24 }, (_, h) => h);
  readonly hora12 = hora12;
  readonly duracion = duracion;

  dias = signal(7);
  cargando = signal(true);
  error = signal(false);
  resumen = signal<ResumenVisitas | null>(null);
  enLinea = signal<{ activas: number; comprando: number } | null>(null);

  constructor() {
    const destroyRef = inject(DestroyRef);
    toObservable(this.dias)
      .pipe(
        tap(() => this.cargando.set(true)),
        switchMap(dias => this.visitasService.resumen(dias).pipe(catchError(() => of(null)))),
        takeUntilDestroyed(destroyRef)
      )
      .subscribe(r => {
        this.cargando.set(false);
        this.error.set(!r);
        if (r) {
          this.resumen.set(r);
          this.enLinea.set({ activas: r.activas, comprando: r.comprando });
        }
      });
    interval(REFRESCO_ACTIVAS_MS)
      .pipe(
        switchMap(() => this.visitasService.activas().pipe(catchError(() => of(null)))),
        takeUntilDestroyed(destroyRef)
      )
      .subscribe(a => a && this.enLinea.set(a));
  }

  // ---------- Indicadores ----------
  conversion = computed(() => {
    const r = this.resumen();
    return r?.visitas ? Math.round((r.compra.compras / r.visitas) * 1000) / 10 : 0;
  });
  nuevos = computed(() => Math.max(0, (this.resumen()?.visitantes ?? 0) - (this.resumen()?.recurrentes ?? 0)));
  movilPct = computed(() => {
    const d = this.resumen()?.dispositivos;
    const total = (d?.movil ?? 0) + (d?.escritorio ?? 0);
    return total ? Math.round(((d?.movil ?? 0) / total) * 100) : 0;
  });

  embudo = computed(() => {
    const pasos = (this.resumen()?.embudo ?? []).filter(p => EMBUDO[p.paso]);
    const base = pasos[0]?.sesiones || 0;
    return pasos.map((p, i) => ({
      etiqueta: EMBUDO[p.paso],
      sesiones: p.sesiones,
      ancho: base ? Math.max(2, (p.sesiones / base) * 100) : 0,
      // Cuántos siguen respecto al paso anterior.
      sigue: i && pasos[i - 1].sesiones ? Math.round((p.sesiones / pasos[i - 1].sesiones) * 100) : null
    }));
  });

  /** Mapa de calor: intensidad 0..100 de cada día y hora. */
  calor = computed(() => {
    const c = this.resumen()?.calor ?? [];
    const max = Math.max(1, ...c.flat());
    return c.map(fila => fila.map(v => ({ v, pct: Math.round((v / max) * 100) })));
  });

  // ---------- Gráficos ----------
  private paleta = computed(() => {
    this.theme.theme(); // recalcula al cambiar de tema
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    return { text: v('--text-muted'), grid: v('--border'), primary: v('--primary'), success: v('--success'), warning: v('--warning'), surface: v('--surface'), muted: v('--border-strong') };
  });

  /** Hoy: visitas por hora. Varios días: visitas por día. */
  tendencia = computed(() => {
    const r = this.resumen();
    const c = this.paleta();
    if (!r) return null;
    const porHora = r.dias === 1;
    const labels = porHora
      ? this.horas.map(hora12)
      : r.porDia.map(d => {
          const [, m, dd] = d.fecha.split('-');
          return `${dd}/${m}`;
        });
    return {
      labels,
      datasets: [
        {
          label: 'Visitas',
          data: porHora ? r.porHora : r.porDia.map(d => d.visitas),
          borderColor: c.primary,
          backgroundColor: c.primary + '26',
          fill: true,
          tension: 0.35,
          pointRadius: r.dias > 30 ? 0 : 3,
          pointBackgroundColor: c.primary
        }
      ]
    };
  });

  /** Visitas por hora del día; la hora pico resaltada. */
  horasChart = computed(() => {
    const r = this.resumen();
    const c = this.paleta();
    if (!r) return null;
    return {
      labels: this.horas.map(hora12),
      datasets: [
        {
          label: 'Visitas',
          data: r.porHora,
          backgroundColor: r.porHora.map((_, h) => (h === r.horaPico ? c.warning : c.primary + 'b3')),
          borderRadius: 6,
          maxBarThickness: 22
        }
      ]
    };
  });

  dispositivosChart = computed(() => {
    const d = this.resumen()?.dispositivos;
    const c = this.paleta();
    return {
      labels: ['Móvil', 'Computadora'],
      datasets: [{ data: [d?.movil ?? 0, d?.escritorio ?? 0], backgroundColor: [c.primary, c.success], borderColor: c.surface, borderWidth: 4, hoverOffset: 6 }]
    };
  });

  ejes = computed(() => {
    const c = this.paleta();
    return {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: c.text, maxRotation: 0, autoSkip: true, autoSkipPadding: 8 }, grid: { display: false }, border: { display: false } },
        y: { beginAtZero: true, ticks: { color: c.text, precision: 0 }, grid: { color: c.grid }, border: { display: false } }
      }
    };
  });

  readonly dona = { maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false } } };
}
