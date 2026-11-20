import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { catchError, forkJoin, of } from 'rxjs';
import { EventsService } from '../../@core/services/events.service';
import { TicketsService } from '../../@core/services/tickets.service';
import { SalonService } from '../../@core/services/salon.service';
import { Event } from '../../@core/models/event.model';
import { Ticket } from '../../@core/models/ticket.model';
import { coloresZonas } from '../../@core/models/salon.model';
import { byDateAsc, eventCategory, isPastEvent, parseEventDate } from '../../@core/utils/event-utils';
import { PlanoSalonComponent } from '../../shared/components/plano-salon/plano-salon.component';

/**
 * El admin decide qué entrada (General, VIP, Palco...) vende cada mesa del
 * salón en un evento. Las mesas sin entrada no se venden. Con al menos una
 * mesa asignada, la página de compra muestra el mapa de puestos.
 */
@Component({
  selector: 'app-salon',
  imports: [DatePipe, FormsModule, PlanoSalonComponent],
  template: `
    <div class="container">
      <div class="table">
        <div class="catalog-head">
          <div class="title">
            <h1>Mapa de mesas</h1>
            <p>Elige el evento y una entrada; luego toca las mesas que la venden (o arrastra el ratón para marcar varias). Tócala otra vez para quitarla; Alt + arrastrar quita varias. Las mesas sin entrada no se venden.</p>
          </div>
          <div class="buttons">
            <label class="selector">
              <span>Evento</span>
              <select class="tm-select" [ngModel]="idEvento()" (ngModelChange)="elegir($event)">
                <option [ngValue]="null" disabled>Elige un evento</option>
                @for (ev of eventosOrdenados(); track ev.idEvents) {
                  <option [ngValue]="ev.idEvents">{{ ev.name }} · {{ fecha(ev) | date: 'dd/MM/yy' }}</option>
                }
              </select>
            </label>
            <button type="button" class="btn guardar" [disabled]="!sucio() || guardando()" (click)="guardar()">
              <i class="pi pi-save"></i> Guardar
            </button>
          </div>
        </div>

        @if (!idEvento()) {
          <p class="vacio">{{ eventosOrdenados().length ? 'Elige un concierto para asignar sus mesas.' : 'No hay conciertos. Crea un evento de tipo Concierto para usar el mapa.' }}</p>
        } @else if (cargando() || !plano()) {
          <div class="tm-skeleton mapa-sk" role="status" aria-label="Cargando mapa"></div>
        } @else if (!tickets().length) {
          <p class="vacio">Este evento aún no tiene entradas. Créalas al editar el evento.</p>
        } @else {
          <div class="pinceles" role="group" aria-label="Entrada que se asigna al tocar una mesa">
            @for (t of tickets(); track t.idTicket) {
              @let r = resumen().get(t.idTicket);
              <button type="button" class="pincel" [class.activo]="pincel() === t.idTicket" [attr.aria-pressed]="pincel() === t.idTicket" (click)="pincel.set(t.idTicket)">
                <i [style.background]="colores().get(t.idTicket)"></i>
                <span>
                  <strong>{{ t.name }}</strong>
                  <small>{{ r ? r.mesas + (r.mesas === 1 ? ' mesa · ' : ' mesas · ') + r.puestos + ' puestos' : 'Sin mesas' }}{{ t.status === 1 ? '' : ' · no está a la venta' }}</small>
                </span>
              </button>
            }
          </div>

          <div class="acciones">
            <button type="button" class="tm-btn tm-btn--ghost tm-btn--sm" (click)="todas()">Todas las mesas con {{ nombrePincel() }}</button>
            <button type="button" class="tm-btn tm-btn--ghost tm-btn--sm" [disabled]="!hayMesas()" (click)="zonas.set({})">Quitar todas</button>
            @if (sucio()) {
              <span class="sucio" role="status"><i class="pi pi-circle-fill"></i> Cambios sin guardar</span>
            }
          </div>

          <app-plano-salon modo="admin" [plano]="plano()!" [zonas]="zonas()" [tickets]="tickets()" [ocupados]="ocupados()" (mesa)="onMesa($event)" (mesas)="onMesas($event)" />
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .selector {
      display: grid;
      flex: 1 1 240px;
      gap: 4px;
      max-width: 360px;

      span {
        color: var(--text-muted);
        font-size: 0.75rem;
        font-weight: 700;
      }
    }

    .guardar::before {
      content: none !important;
    }

    .buttons {
      flex: 1 1 420px;
      flex-wrap: nowrap;
      align-items: flex-end;
      justify-content: flex-end;
    }

    .guardar {
      flex: none;

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }

    @media (max-width: 640px) {
      .buttons {
        flex-direction: column;
        align-items: stretch;
      }

      .selector {
        flex: none;
        max-width: none;
      }

      .guardar {
        width: 100% !important;
      }
    }

    .vacio {
      margin: 0;
      padding: 2rem 0;
      color: var(--text-muted);
      text-align: center;
    }

    .mapa-sk {
      height: 480px;
    }

    .pinceles {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem;
      margin-bottom: 0.75rem;
    }

    .pincel {
      display: inline-flex;
      align-items: center;
      gap: 0.6rem;
      min-height: 52px;
      padding: 0.5rem 1rem;
      border: 1.5px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface-2);
      color: var(--text);
      font: inherit;
      text-align: left;
      cursor: pointer;

      i {
        flex: none;
        width: 16px;
        height: 16px;
        border-radius: 4px;
      }

      span {
        display: grid;
      }

      small {
        color: var(--text-muted);
        font-size: 0.75rem;
      }

      &.activo {
        border-color: var(--primary);
        box-shadow: 0 0 0 3px var(--primary-soft);
      }
    }

    .acciones {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .sucio {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      color: var(--warning, #d97706);
      font-size: 0.85rem;
      font-weight: 700;

      .pi {
        font-size: 0.5rem;
      }
    }
  `
})
export class SalonComponent {
  private eventsService = inject(EventsService);
  private ticketsService = inject(TicketsService);
  private salonService = inject(SalonService);
  private messageService = inject(MessageService);

  readonly plano = toSignal(this.salonService.plano$);
  readonly eventos = signal<Event[]>([]);
  /** El mapa es solo para conciertos. */
  readonly eventosOrdenados = computed(() => this.eventos().filter(e => eventCategory(e) === 'concierto').sort((a, b) => byDateAsc(b, a)));
  readonly idEvento = signal<number | null>(null);
  readonly tickets = signal<Ticket[]>([]);
  /** { [mesa]: idTicket } tal como se ve en pantalla. */
  readonly zonas = signal<Record<number, number>>({});
  private guardadas = signal<Record<number, number>>({});
  readonly ocupados = signal<Record<string, string>>({});
  /** Entrada que se asigna al tocar una mesa. */
  readonly pincel = signal<number | null>(null);
  readonly cargando = signal(false);
  readonly guardando = signal(false);

  readonly sucio = computed(() => JSON.stringify(this.zonas()) !== JSON.stringify(this.guardadas()));
  readonly hayMesas = computed(() => Object.keys(this.zonas()).length > 0);
  readonly nombrePincel = computed(() => this.tickets().find(t => t.idTicket === this.pincel())?.name ?? '');

  /** Mesas y puestos que vende cada entrada. */
  readonly resumen = computed(() => {
    const r = new Map<number, { mesas: number; puestos: number }>();
    for (const m of this.plano()?.mesas ?? []) {
      const idTicket = this.zonas()[m.mesa];
      if (!idTicket) continue;
      const x = r.get(idTicket) ?? { mesas: 0, puestos: 0 };
      x.mesas++;
      x.puestos += m.asientos.length;
      r.set(idTicket, x);
    }
    return r;
  });

  constructor() {
    this.eventsService.getEvents().subscribe(eventos => {
      this.eventos.set(eventos ?? []);
      // Arranca en el próximo concierto, que es donde se usa el mapa.
      const proximo = (eventos ?? []).filter(e => !isPastEvent(e) && eventCategory(e) === 'concierto').sort(byDateAsc)[0];
      if (proximo && this.idEvento() === null) this.elegir(proximo.idEvents);
    });
  }

  fecha(ev: Event) {
    return parseEventDate(ev.date);
  }

  readonly colores = computed(() => coloresZonas(this.tickets()));

  elegir(idEvents: number) {
    this.idEvento.set(idEvents);
    this.cargando.set(true);
    forkJoin({
      tickets: this.ticketsService.getTicktesByEvent(idEvents).pipe(catchError(() => of([] as Ticket[]))),
      estado: this.salonService.estado(idEvents)
    }).subscribe({
      next: ({ tickets, estado }) => {
        // Se cambió de evento mientras cargaba: esta respuesta ya no sirve.
        if (this.idEvento() !== idEvents) return;
        this.tickets.set(tickets ?? []);
        this.zonas.set(estado.zonas);
        this.guardadas.set(estado.zonas);
        this.ocupados.set(estado.ocupados);
        this.pincel.set(tickets?.[0]?.idTicket ?? null);
        this.cargando.set(false);
      },
      error: err => {
        this.cargando.set(false);
        this.messageService.add({ severity: 'error', summary: 'Mapa de mesas', detail: err?.error?.message ?? 'No se pudo cargar el mapa' });
      }
    });
  }

  /** Asigna la entrada elegida a la mesa; si ya la tenía, la quita. */
  onMesa(mesa: number) {
    const idTicket = this.pincel();
    if (!idTicket) return;
    this.zonas.update(z => {
      const { [mesa]: actual, ...resto } = z;
      return actual === idTicket ? resto : { ...resto, [mesa]: idTicket };
    });
  }

  /** Rectángulo arrastrado en el plano: asigna la entrada elegida a esas mesas, o las quita (Alt). */
  onMesas({ mesas, quitar }: { mesas: number[]; quitar: boolean }) {
    const idTicket = this.pincel();
    if (!idTicket && !quitar) return;
    this.zonas.update(z => {
      const nuevo = { ...z };
      for (const mesa of mesas) {
        if (quitar) delete nuevo[mesa];
        else nuevo[mesa] = idTicket!;
      }
      return nuevo;
    });
  }

  todas() {
    const idTicket = this.pincel();
    if (!idTicket) return;
    this.zonas.set(Object.fromEntries((this.plano()?.mesas ?? []).map(m => [m.mesa, idTicket])));
  }

  guardar() {
    const idEvents = this.idEvento();
    if (!idEvents) return;
    const zonas = Object.entries(this.zonas()).map(([mesa, idTicket]) => ({ mesa: Number(mesa), idTicket }));
    this.guardando.set(true);
    this.salonService.guardarZonas(idEvents, zonas).subscribe({
      next: estado => {
        this.guardando.set(false);
        this.zonas.set(estado.zonas);
        this.guardadas.set(estado.zonas);
        this.ocupados.set(estado.ocupados);
        this.messageService.add({
          severity: 'success',
          summary: 'Mapa guardado',
          detail: zonas.length ? `${zonas.length} ${zonas.length === 1 ? 'mesa' : 'mesas'} a la venta` : 'Este evento ya no usa el mapa'
        });
      },
      error: err => {
        this.guardando.set(false);
        this.messageService.add({ severity: 'error', summary: 'No se guardó', detail: err?.error?.message ?? 'Intenta de nuevo' });
      }
    });
  }
}
