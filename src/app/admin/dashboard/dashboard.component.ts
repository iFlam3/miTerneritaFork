import { DatePipe, DecimalPipe } from '@angular/common';
import { MessageService } from 'primeng/api';
import { TasaService } from '../../@core/services/tasa.service';
import { Component, computed, DestroyRef, ElementRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ChartModule } from 'primeng/chart';
import { SelectButtonModule } from 'primeng/selectbutton';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, interval, merge, of, startWith, switchMap, timer } from 'rxjs';
import { environment } from '../../../environments/environment.developer';
import { VisitasService } from '../../@core/services/visitas.service';
import { ContarDirective } from '../../shared/directives/contar.directive';
import { fraseDeLaHora } from './frases';
import { DashboardService } from '../../@core/services/dashboard.service';
import { PaymentService } from '../../@core/services/payment.service';
import { EventsService } from '../../@core/services/events.service';
import { ThemeService } from '../../@core/services/theme.service';
import { UpdatePaymentComponent } from '../payments/components/update-payment/update-payment.component';
import { Payment } from '../../@core/models/payment.model';
import { Event } from '../../@core/models/event.model';
import { byDateAsc, eventImage, formatTime12, isPastEvent, parseEventDate } from '../../@core/utils/event-utils';

type Filter = 'day' | 'week' | 'month' | 'year';

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
/** Cuántos períodos recientes mostrar en los gráficos */
const LIMIT: Record<Filter, number> = { day: 14, week: 12, month: 12, year: 6 };
/** Cada cuánto se vuelven a pedir pagos y último escaneo (aviso de pagos nuevos). */
const REFRESCO_MS = 60_000;
const MIN_MS = 60_000;

/** "hace un momento", "hace 4 min", "hace 2 h", "hace 3 d". */
function hace(fecha: Date, ahora: Date): string {
  const min = Math.max(0, Math.floor((ahora.getTime() - fecha.getTime()) / MIN_MS));
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  if (min < 1440) return `hace ${Math.floor(min / 60)} h`;
  return `hace ${Math.floor(min / 1440)} d`;
}

import { CapFirstPipe } from '../../shared/pipes/cap-first.pipe';
import { AvatarComponent, avatarSeed } from '../../shared/components/avatar/avatar.component';
import { VisitasPanelComponent } from './components/visitas-panel/visitas-panel.component';

@Component({
  selector: 'app-dashboard',
  imports: [AvatarComponent, CapFirstPipe, ChartModule, ContarDirective, DatePipe, DecimalPipe, FormsModule, RouterLink, SelectButtonModule, VisitasPanelComponent],
  // De día la foto de fondo es la del Manhattan bar (con luz); de noche, la barra.
  host: { '[class.de-dia]': 'deDia()' },
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  private dashboardService = inject(DashboardService);
  private paymentsService = inject(PaymentService);
  private eventsService = inject(EventsService);
  private dialogService = inject(DialogService);
  private theme = inject(ThemeService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private messageService = inject(MessageService);
  private visitasService = inject(VisitasService);
  private http = inject(HttpClient);
  private destroyRef = inject(DestroyRef);
  readonly tasa = inject(TasaService);
  ref: DynamicDialogRef | undefined;
  refrescandoTasa = signal(false);
  readonly seed = avatarSeed;

  readonly today = new Date();
  readonly userName = (JSON.parse(localStorage.getItem('user') || '{}').name as string) ?? '';

  // ---------- Toque vivo ----------
  /** Reloj del panel: mueve la cuenta regresiva, el "hace X min" y la frase de cada hora. */
  readonly ahora = signal(new Date());
  private hora = computed(() => this.ahora().getHours());
  saludo = computed(() => {
    const h = this.hora();
    return h < 5 ? 'Trasnochando' : h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  });
  deDia = computed(() => this.hora() >= 6 && this.hora() < 18);
  enLinea = signal<{ activas: number; comprando: number } | null>(null);
  private ultimoEscaneo = signal<Date | null>(null);
  private visitasHoy = signal<{ visitas: number; movil: number } | null>(null);
  private topEvento = signal<string | null>(null);
  /** Pagos por verificar que llegaron mientras se mira el panel: la tarjeta destella con "+n". */
  nuevosPendientes = signal(0);

  loadingKpis = signal(true);
  loadingPayments = signal(true);

  private allPayments = signal<any[]>([]);
  private allUsers = signal<any[]>([]);
  private events = signal<Event[]>([]);

  selectedFilter = signal<Filter>('month');
  selectedUserFilter = signal<Filter>('month');
  filterOptions = [
    { label: 'Día', value: 'day' },
    { label: 'Semana', value: 'week' },
    { label: 'Mes', value: 'month' },
    { label: 'Año', value: 'year' }
  ];

  /** Evento elegido para los indicadores de entradas y pagos (null = todos). */
  eventoFiltro = signal<number | null>(null);

  // ---------- Derivados ----------
  /** Solo clientes: el personal y los admin no cuentan como registros. */
  private clientes = computed(() => this.allUsers().filter(u => u.roleName === 'client'));
  totalClientes = computed(() => this.clientes().length);
  clientesHoy = computed(() => {
    const hoy = new Date().toDateString();
    return this.clientes().filter(u => u.fechaRegistro && new Date(u.fechaRegistro).toDateString() === hoy).length;
  });

  /** Eventos para el selector, el más reciente primero. */
  eventosFiltro = computed(() => [...this.events()].sort((a, b) => byDateAsc(b, a)));

  private pagosFiltrados = computed(() => {
    const id = this.eventoFiltro();
    return id === null ? this.allPayments() : this.allPayments().filter(p => p.idEvents?.idEvents === id);
  });
  pagosEvento = computed(() => {
    const counts = { total: 0, Aprobado: 0, Pendiente: 0, entradas: 0 };
    for (const p of this.pagosFiltrados()) {
      counts.total++;
      if (p.status === 'Aprobado') {
        counts.Aprobado++;
        // Mismo criterio que /payment-details/totals/general: entradas de pagos aprobados.
        for (const d of p.paymentDetails ?? []) if (!d.isDeleted) counts.entradas += Number(d.ticketNum ?? 1);
      } else if (p.status === 'Pendiente') counts.Pendiente++;
    }
    return counts;
  });

  latestPayments = computed(() =>
    [...this.allPayments()].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 6)
  );

  allPaymentsCount = computed(() => this.allPayments().length);

  statusCounts = computed(() => {
    const counts = { Aprobado: 0, Pendiente: 0, Rechazado: 0 };
    for (const p of this.allPayments()) {
      if (p.status === 'Aprobado') counts.Aprobado++;
      else if (p.status === 'Pendiente') counts.Pendiente++;
      else counts.Rechazado++;
    }
    return counts;
  });

  /** Entradas aprobadas por evento (mismo criterio que la tarjeta "Entradas vendidas"). */
  private vendidasPorEvento = computed(() => {
    const m = new Map<number, number>();
    for (const p of this.allPayments()) {
      const id = p.idEvents?.idEvents;
      if (p.status !== 'Aprobado' || !id) continue;
      for (const d of p.paymentDetails ?? []) if (!d.isDeleted) m.set(id, (m.get(id) ?? 0) + Number(d.ticketNum ?? 1));
    }
    return m;
  });

  upcoming = computed(() =>
    this.events()
      .filter(e => e.status === 1 && !isPastEvent(e))
      .sort(byDateAsc)
      .slice(0, 4)
      .map(e => {
        const vendidas = this.vendidasPorEvento().get(e.idEvents) ?? 0;
        const aforo = Number(e.capacity) || 0;
        return {
          ...e,
          day: parseEventDate(e.date),
          timeLabel: formatTime12(e.time),
          flyerUrl: eventImage(e.flyer),
          vendidas,
          aforo,
          aforoPct: aforo ? Math.min(100, (vendidas / aforo) * 100) : 0
        };
      })
  );

  /** Próximo evento: "faltan 2 d 5 h", "empieza en 40 min" o "está ocurriendo ahora". */
  cuentaAtras = computed(() => {
    const ev = this.upcoming()[0];
    if (!ev?.day) return null;
    const [h, m] = String(ev.time ?? '00:00').split(':').map(Number);
    const inicio = new Date(ev.day);
    inicio.setHours(h || 0, m || 0, 0, 0);
    const min = Math.floor((inicio.getTime() - this.ahora().getTime()) / MIN_MS);
    const texto =
      min <= 0 ? 'está ocurriendo ahora'
      : min < 60 ? `empieza en ${min} min`
      : min < 1440 ? `faltan ${Math.floor(min / 60)} h ${min % 60} min`
      : `faltan ${Math.floor(min / 1440)} d ${Math.floor((min % 1440) / 60)} h`;
    return { nombre: ev.name, texto };
  });

  /** "Último pago hace 4 min · última entrada escaneada hace 12 min". */
  actividad = computed(() => {
    const ahora = this.ahora();
    const ultimoPago = this.allPayments().reduce<Date | null>((max, p) => {
      const d = p.date ? new Date(p.date) : null;
      return d && !Number.isNaN(d.getTime()) && (!max || d > max) ? d : max;
    }, null);
    const escaneo = this.ultimoEscaneo();
    const partes = [
      ultimoPago ? `Último pago ${hace(ultimoPago, ahora)}` : null,
      escaneo ? `última entrada escaneada ${hace(escaneo, ahora)}` : null
    ].filter(Boolean);
    return partes.length ? partes.join(' · ') : null;
  });

  /** Frase bajo el saludo: cambia cada hora según la hora, el día y lo que pasa en la web. */
  frase = computed(() => {
    const generica = 'Este es el resumen de ventas y actividad de Mi Ternerita House.';
    if (this.loadingPayments() || this.loadingKpis()) return generica;
    const ahora = this.ahora();
    const hoy = ahora.toDateString();
    const semana = ahora.getTime() - 7 * 1440 * MIN_MS;
    let minutosVerificacion: number | null = null;
    let rechazados = 0;
    for (const p of this.allPayments()) {
      const fecha = new Date(p.date);
      if (p.status === 'Rechazado' && fecha.getTime() >= semana) rechazados++;
      if (!p.revisado || new Date(p.revisado).toDateString() !== hoy) continue;
      const min = Math.floor((new Date(p.revisado).getTime() - fecha.getTime()) / MIN_MS);
      if (min >= 0 && (minutosVerificacion === null || min < minutosVerificacion)) minutosVerificacion = min;
    }
    const v = this.visitasHoy();
    return fraseDeLaHora(ahora, {
      pendientes: this.statusCounts().Pendiente,
      clientesHoy: this.clientesHoy(),
      entradas: this.pagosEvento().entradas,
      enLinea: this.enLinea()?.activas ?? 0,
      comprando: this.enLinea()?.comprando ?? 0,
      hayProximos: this.upcoming().length > 0,
      topEvento: this.topEvento(),
      visitasHoy: v?.visitas ?? null,
      movilPct: v?.visitas ? Math.round((v.movil / v.visitas) * 100) : null,
      minutosVerificacion,
      rechazados
    });
  });

  // ---------- Colores según el tema ----------
  private palette = computed(() => {
    this.theme.theme(); // dependencia: recalcula al cambiar de tema
    // Del propio dashboard: ahí están los colores del estilo liquid.
    const css = getComputedStyle(this.host.nativeElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    return {
      text: v('--text-muted'),
      grid: v('--border'),
      primary: v('--primary'),
      success: v('--success'),
      warning: v('--warning'),
      danger: v('--danger'),
      surface: v('--surface')
    };
  });

  paymentsChart = computed(() => {
    const c = this.palette();
    const { labels, data } = this.groupByPeriod(this.allPayments(), this.selectedFilter(), 'date');
    return {
      labels,
      datasets: [
        {
          label: 'Pagos',
          data,
          backgroundColor: c.primary,
          hoverBackgroundColor: c.primary,
          borderRadius: 8,
          maxBarThickness: 36
        }
      ]
    };
  });

  usersChart = computed(() => {
    const c = this.palette();
    const { labels, data } = this.groupByPeriod(this.clientes(), this.selectedUserFilter(), 'fechaRegistro');
    return {
      labels,
      datasets: [
        {
          label: 'Nuevos clientes',
          data,
          borderColor: c.success,
          backgroundColor: c.success + '22',
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: c.success
        }
      ]
    };
  });

  statusChart = computed(() => {
    const c = this.palette();
    const s = this.statusCounts();
    return {
      labels: ['Aprobados', 'Pendientes', 'Rechazados'],
      datasets: [
        {
          data: [s.Aprobado, s.Pendiente, s.Rechazado],
          backgroundColor: [c.success, c.warning, c.danger],
          borderColor: c.surface,
          borderWidth: 4,
          hoverOffset: 6
        }
      ]
    };
  });

  axisOptions = computed(() => {
    const c = this.palette();
    return {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: c.text }, grid: { display: false }, border: { display: false } },
        y: { beginAtZero: true, ticks: { color: c.text, precision: 0 }, grid: { color: c.grid }, border: { display: false } }
      }
    };
  });

  doughnutOptions = computed(() => ({
    maintainAspectRatio: false,
    cutout: '72%',
    plugins: { legend: { display: false } }
  }));

  ngOnInit() {
    // Además de recargar tras cada cambio, cada minuto: así se ven los pagos que llegan.
    merge(this.paymentsService.refreshPaymentsObservable$, interval(REFRESCO_MS))
      .pipe(
        startWith(null),
        switchMap(() => this.paymentsService.getAllPayments()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(payments => {
        const antes = this.statusCounts().Pendiente;
        const primeraCarga = this.loadingPayments();
        this.allPayments.set(payments || []);
        this.loadingPayments.set(false);
        const nuevos = this.statusCounts().Pendiente - antes;
        if (!primeraCarga && nuevos > 0) {
          this.nuevosPendientes.set(nuevos);
          setTimeout(() => this.nuevosPendientes.set(0), 6000);
        }
      });

    timer(0, REFRESCO_MS)
      .pipe(
        switchMap(() =>
          this.http.get<{ fecha: string }[]>(`${environment.api}/code/scans`, { params: { limit: 1 } }).pipe(catchError(() => of([])))
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(scans => this.ultimoEscaneo.set(scans[0]?.fecha ? new Date(scans[0].fecha) : null));

    timer(0, 30_000)
      .pipe(
        switchMap(() => this.visitasService.activas().pipe(catchError(() => of(null)))),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(e => this.enLinea.set(e));

    this.visitasService.resumen(1).subscribe({
      next: r => this.visitasHoy.set({ visitas: r.visitas, movil: r.dispositivos.movil }),
      error: () => undefined
    });
    this.visitasService.resumen(7).subscribe({ next: r => this.topEvento.set(r.topEventos[0]?.nombre ?? null), error: () => undefined });

    const reloj = setInterval(() => this.ahora.set(new Date()), 30_000);
    this.destroyRef.onDestroy(() => clearInterval(reloj));

    // Entradas y pagos salen de getAllPayments (arriba), así se pueden filtrar por evento.
    this.dashboardService.getTotalUsers().subscribe({
      next: (users: any) => {
        this.allUsers.set(users || []);
        this.loadingKpis.set(false);
      },
      error: () => this.loadingKpis.set(false)
    });

    this.eventsService.getEvents().subscribe(events => this.events.set(events ?? []));
  }

  refrescarTasa() {
    this.refrescandoTasa.set(true);
    const antes = this.tasa.tasa();
    this.tasa.refrescar().subscribe({
      next: t => {
        this.refrescandoTasa.set(false);
        const fecha = t.fecha ? new Date(t.fecha).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' }) : '';
        // El BCV no publica fines de semana ni feriados: entonces la vigente sigue siendo la última.
        const igual = antes?.valor === t.valor && antes?.fecha === t.fecha;
        this.messageService.add(
          igual
            ? { severity: 'info', summary: 'Ya tienes la tasa más reciente', detail: `El BCV aún no publica una nueva. Vigente del ${fecha}: ${t.valor} Bs/$` }
            : { severity: 'success', summary: 'Tasa actualizada', detail: `${t.valor} Bs/$ · vigente del ${fecha}` }
        );
      },
      error: err => {
        this.refrescandoTasa.set(false);
        this.messageService.add({ severity: 'error', summary: 'Tasa BCV', detail: err?.error?.message ?? 'No se pudo actualizar la tasa' });
      }
    });
  }

  statusClass(status: string) {
    return status === 'Aprobado' ? 'tm-badge--success' : status === 'Pendiente' ? 'tm-badge--warning' : 'tm-badge--danger';
  }

  /** Agrupa por período, ordena cronológicamente y deja solo los últimos N. */
  private groupByPeriod(items: any[], period: Filter, dateField: string) {
    const buckets = new Map<number, { label: string; count: number }>();

    for (const item of items) {
      const raw = item?.[dateField];
      if (!raw) continue;
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) continue;

      let start: Date;
      let label: string;
      switch (period) {
        case 'day':
          start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
          label = `${start.getDate()} ${MONTHS[start.getMonth()]}`;
          break;
        case 'week': {
          start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
          label = `${start.getDate()} ${MONTHS[start.getMonth()]}`;
          break;
        }
        case 'month':
          start = new Date(d.getFullYear(), d.getMonth(), 1);
          label = `${MONTHS[start.getMonth()]} ${String(start.getFullYear()).slice(2)}`;
          break;
        default:
          start = new Date(d.getFullYear(), 0, 1);
          label = `${start.getFullYear()}`;
      }

      const key = start.getTime();
      const bucket = buckets.get(key) ?? { label, count: 0 };
      bucket.count += item.amount ? Number(item.amount) : 1;
      buckets.set(key, bucket);
    }

    const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0]).slice(-LIMIT[period]);
    return { labels: sorted.map(([, b]) => b.label), data: sorted.map(([, b]) => b.count) };
  }

  openUpdateModal(payment: Payment) {
    this.ref = this.dialogService.open(UpdatePaymentComponent, {
      header: 'Revisar pago',
      width: '820px',
      modal: true,
      closable: true,
      data: { payment },
      breakpoints: { '960px': '94vw' }
    });
  }
}
