import { DatePipe, DecimalPipe } from '@angular/common';
import { TimerServiceService } from '../../@core/services/timer-service.service';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { catchError, interval, of } from 'rxjs';
import { TicketsService } from '../../@core/services/tickets.service';
import { Ticket } from '../../@core/models/ticket.model';
import { Event } from '../../@core/models/event.model';
import { EventsService } from '../../@core/services/events.service';
import { SalonService } from '../../@core/services/salon.service';
import { AuthService } from '../../@core/services/auth.service';
import { EstadoSalon, PlanoSalon } from '../../@core/models/salon.model';
import { byDateAsc, eventCategory, eventImage, formatTime12, isPastEvent, parseEventDate } from '../../@core/utils/event-utils';
import { PurchaseStepsComponent } from '../../shared/components/purchase-steps/purchase-steps.component';
import { ACCESO_POR_BOTELLA } from '../../@core/models/menu.model';
import { PriceSummaryComponent } from '../../shared/components/price-summary/price-summary.component';
import { PlanoSalonComponent } from '../../shared/components/plano-salon/plano-salon.component';

/** Máximo de entradas por compra */
const MAX_TICKETS = 10;

/** Cada cuánto se refrescan los puestos que toman otros clientes. */
const REFRESCO_SALON_MS = 15_000;

/** "12A" → mesa 12. */
const mesaDe = (asiento: string) => parseInt(asiento, 10);

import { CapFirstPipe } from '../../shared/pipes/cap-first.pipe';

@Component({
  selector: 'app-ticket',
  imports: [CapFirstPipe, DatePipe, DecimalPipe, PurchaseStepsComponent, PlanoSalonComponent, PriceSummaryComponent],
  templateUrl: './ticket.component.html',
  styleUrl: './ticket.component.scss'
})
export class TicketComponent implements OnInit {
  private ticketService = inject(TicketsService);
  private messageService = inject(MessageService);
  private eventsService = inject(EventsService);
  private router = inject(Router);
  private timerService = inject(TimerServiceService);
  private route = inject(ActivatedRoute);
  private salonService = inject(SalonService);
  private auth = inject(AuthService);
  private destroyRef = inject(DestroyRef);

  readonly max = MAX_TICKETS;
  idEvent!: number;

  event = signal<Event | null>(null);
  zones = signal<Ticket[]>([]);
  loading = signal(true);
  quantities = signal<Record<number, number>>({});
  activeZone = signal<number | null>(null);
  /** /concierto sin conciertos próximos. */
  noConcert = signal(false);

  /** Mapa del salón: solo si el admin le asignó mesas al evento. */
  plano = signal<PlanoSalon | null>(null);
  salon = signal<EstadoSalon | null>(null);
  /** Puestos elegidos en el mapa ("5A"). */
  asientos = signal<string[]>([]);
  /** Tipos de entrada que se venden por mesa: su cantidad sale de los puestos elegidos. */
  conMesa = computed(() => new Set(Object.values(this.salon()?.zonas ?? {})));

  /** Con consumo se puede seguir sin entradas: una botella puede incluir el acceso. */
  // Sin entradas solo se sigue si una botella puede dar el acceso.
  reservando = signal(false);
  canContinue = computed(() => this.count() > 0 || (ACCESO_POR_BOTELLA && this.event()?.consumo === 1));

  day = computed(() => parseEventDate(this.event()?.date));
  time = computed(() => formatTime12(this.event()?.time));
  flyer = computed(() => eventImage(this.event()?.flyer || this.event()?.image1) || 'assets/img/optimized/fondo1.webp');
  backdrop = computed(() => eventImage(this.event()?.image3 || this.event()?.image1) || this.flyer());

  /** Entradas por tipo: las de mesa cuentan sus puestos; el resto, el selector +/-. */
  cantidades = computed(() => {
    const zonas = this.salon()?.zonas ?? {};
    const c: Record<number, number> = {};
    for (const z of this.zones()) {
      if (!this.conMesa().has(z.idTicket)) c[z.idTicket] = this.quantities()[z.idTicket] ?? 0;
    }
    for (const a of this.asientos()) {
      const idTicket = zonas[mesaDe(a)];
      if (idTicket) c[idTicket] = (c[idTicket] ?? 0) + 1;
    }
    return c;
  });

  count = computed(() => Object.values(this.cantidades()).reduce((acc, n) => acc + n, 0));

  /** Mismo formato que esperan checkout y payment: { id, name, cantidad, total } */
  selected = computed(() =>
    this.zones()
      .filter(z => (this.cantidades()[z.idTicket] ?? 0) > 0)
      .map(z => {
        const cantidad = this.cantidades()[z.idTicket];
        return { id: z.idTicket, name: z.name, cantidad, total: cantidad * Number(z.price) };
      })
  );

  total = computed(() => this.selected().reduce((acc, item) => acc + item.total, 0));

  asientosOrdenados = computed(() => [...this.asientos()].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })));

  ngOnInit() {
    // Al volver desde consumo o datos: se recuperan las cantidades elegidas
    // (los puestos del mapa vuelven solos: siguen apartados a nombre del cliente).
    const previas = (history.state?.selected as { id: number; cantidad: number }[] | undefined) ?? [];
    if (previas.length) this.quantities.set(Object.fromEntries(previas.map(s => [s.id, s.cantidad])));

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.load(Number(id));
      return;
    }

    // /concierto: el próximo concierto de la cartelera
    this.eventsService.getEvents().subscribe(events => {
      const next = (events ?? [])
        .filter(e => e.status === 1 && !isPastEvent(e) && eventCategory(e) === 'concierto')
        .sort(byDateAsc)[0];
      if (next) {
        this.load(next.idEvents);
      } else {
        this.noConcert.set(true);
        this.loading.set(false);
      }
    });
  }

  private load(idEvent: number) {
    this.idEvent = idEvent;

    this.ticketService
      .getTicktesByEvent(this.idEvent)
      .pipe(catchError(() => of([] as Ticket[])))
      .subscribe(tickets => {
        this.zones.set((tickets ?? []).filter(t => t.status === 1));
        this.loading.set(false);
      });

    this.eventsService.getEventById(this.idEvent).subscribe({
      next: event => this.event.set(event)
    });

    this.refrescarSalon(true);
  }

  /** Zonas por mesa y puestos tomados. La primera vez retoma lo que el cliente ya tenía apartado. */
  private refrescarSalon(primera = false) {
    this.salonService
      .estado(this.idEvent)
      .pipe(catchError(() => of(null)))
      .subscribe(estado => {
        if (!estado) return;
        if (primera) {
          if (!Object.keys(estado.zonas).length) return;
          this.asientos.set(estado.mios);
          this.salonService.plano$.subscribe(plano => this.plano.set(plano));
          interval(REFRESCO_SALON_MS)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.refrescarSalon());
        } else {
          // Lo que otro cliente apartó mientras elegías se suelta.
          const perdidos = this.asientos().filter(a => estado.ocupados[a]);
          if (perdidos.length) {
            this.asientos.update(s => s.filter(a => !estado.ocupados[a]));
            this.messageService.add({
              severity: 'warn',
              summary: perdidos.length === 1 ? 'Puesto tomado' : 'Puestos tomados',
              detail: `${perdidos.join(', ')} ya ${perdidos.length === 1 ? 'lo tomó' : 'los tomó'} otra persona. Elige otro en el mapa.`
            });
          }
        }
        this.salon.set(estado);
      });
  }

  qty(zone: Ticket) {
    return this.cantidades()[zone.idTicket] ?? 0;
  }

  price(zone: Ticket) {
    return Number(zone.price);
  }

  private avisoLimite(detail = `Puedes comprar hasta ${MAX_TICKETS} entradas por compra.`) {
    this.messageService.add({ severity: 'warn', summary: 'Límite alcanzado', detail });
  }

  increment(zone: Ticket) {
    if (this.count() >= MAX_TICKETS) {
      this.avisoLimite();
      return;
    }
    this.activeZone.set(zone.idTicket);
    this.quantities.update(q => ({ ...q, [zone.idTicket]: (q[zone.idTicket] ?? 0) + 1 }));
  }

  decrement(zone: Ticket) {
    this.activeZone.set(zone.idTicket);
    this.quantities.update(q => ({ ...q, [zone.idTicket]: Math.max((q[zone.idTicket] ?? 0) - 1, 0) }));
  }

  /** Quitar un tipo del resumen: también suelta sus puestos del mapa. */
  clearSelection(id: number): void {
    this.quantities.update(q => ({ ...q, [id]: 0 }));
    const zonas = this.salon()?.zonas ?? {};
    this.asientos.update(s => s.filter(a => zonas[mesaDe(a)] !== id));
  }

  irAlMapa() {
    document.getElementById('mapa-salon')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Toca un puesto del mapa: lo elige o lo suelta. */
  onAsiento(id: string) {
    if (this.asientos().includes(id)) {
      this.asientos.update(s => s.filter(a => a !== id));
    } else if (this.count() >= MAX_TICKETS) {
      this.avisoLimite();
    } else {
      this.asientos.update(s => [...s, id]);
    }
  }

  /** Toca el número de una mesa: toma todos sus puestos libres; si ya los tenía, la suelta. */
  onMesa(mesa: number) {
    const ocupados = this.salon()?.ocupados ?? {};
    const libres = (this.plano()?.mesas.find(m => m.mesa === mesa)?.asientos ?? []).map(a => mesa + a[0]).filter(id => !ocupados[id]);
    const faltan = libres.filter(id => !this.asientos().includes(id));

    if (!libres.length) {
      this.messageService.add({ severity: 'info', summary: `Mesa ${mesa}`, detail: 'Ya no tiene puestos libres.' });
    } else if (!faltan.length) {
      this.asientos.update(s => s.filter(a => !libres.includes(a)));
    } else if (this.count() + faltan.length > MAX_TICKETS) {
      this.avisoLimite(`La mesa ${mesa} tiene ${faltan.length} puestos libres y te quedan ${MAX_TICKETS - this.count()}. Elige puestos sueltos.`);
    } else {
      this.asientos.update(s => [...s, ...faltan]);
    }
  }

  goToCheckout() {
    if (!this.canContinue()) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Elige tus entradas',
        detail: 'Debes seleccionar al menos una entrada antes de continuar.'
      });
      return;
    }

    // Ver precios y mapa es público; apartar necesita sesión.
    if (!this.auth.isAuthenticated()) {
      this.messageService.add({ severity: 'info', summary: 'Inicia sesión', detail: 'Inicia sesión para apartar tus entradas.' });
      this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return;
    }

    // Se apartan las entradas (nadie más puede tomarlas mientras pagas) y desde
    // ahí corre el contador, igual que el apartado en el servidor.
    this.reservando.set(true);
    this.eventsService.reservar(this.idEvent, this.count(), this.asientosOrdenados()).subscribe({
      next: ({ vence }) => {
        this.reservando.set(false);
        this.timerService.iniciarHasta(new Date(vence).getTime());
        // Con consumo se pasa por la carta: comida, bebida o una botella con acceso.
        const step = this.event()?.consumo === 1 ? 'consume' : 'checkout';
        this.router.navigate(['/home/event', this.idEvent, 'ticket', step], {
          state: { selected: this.selected(), asientos: this.asientosOrdenados() }
        });
      },
      error: err => {
        this.reservando.set(false);
        this.messageService.add({
          severity: 'warn',
          summary: 'No se pudieron apartar',
          detail: err?.error?.message ?? 'Intenta de nuevo en un momento.'
        });
        // Un puesto lo tomó otra persona: el mapa se pone al día y lo suelta.
        if (err?.status === 409) this.refrescarSalon();
      }
    });
  }
}
