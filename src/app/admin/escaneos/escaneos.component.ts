import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { catchError, of } from 'rxjs';
import { environment } from '../../../environments/environment.developer';
import { EventsService } from '../../@core/services/events.service';
import { Event } from '../../@core/models/event.model';
import { byDateAsc, parseEventDate } from '../../@core/utils/event-utils';

interface Escaneo {
  idScan: number;
  origen: 'app' | 'web' | 'manual' | string;
  fecha: string;
  total: number;
  idEvents: number | null;
  idPayment: number;
  usuario: { nombre: string } | null;
  deshecho: boolean;
  entradas: { tipo: string; cantidad: number }[];
  cliente?: { nombre: string; cedula: string | null } | null;
  evento?: string | null;
  monto?: number;
}

/** AAAA-MM-DD de hoy en Venezuela (UTC-4). */
const hoyVe = (dias = 0) => new Date(Date.now() - 4 * 3_600_000 + dias * 86_400_000).toISOString().slice(0, 10);

/** shortcut: muestra hasta 500 escaneos por consulta; si un rango tiene más, acotar fechas o paginar. */
const LIMITE = 500;

/**
 * Historial de entradas: quién pasó, cuándo, en qué evento, cuántas entradas
 * y su valor. Sale del registro de escaneos de la puerta (app, web y marcas
 * manuales del admin).
 */
@Component({
  selector: 'app-escaneos',
  imports: [DatePipe, DecimalPipe, FormsModule],
  template: `
    <div class="container">
      <div class="table">
        <div class="catalog-head">
          <div class="title">
            <h1>Historial de entradas</h1>
            <p>Quién pasó por la puerta, cuándo, con cuántas entradas y por cuánto. Los escaneos deshechos no suman.</p>
          </div>
        </div>

        <form class="filtros" (ngSubmit)="cargar()">
          <label>
            <span>Evento</span>
            <select class="tm-select" name="evento" [ngModel]="idEvento()" (ngModelChange)="idEvento.set($event)">
              <option [ngValue]="null">Todos los eventos</option>
              @for (ev of eventosOrdenados(); track ev.idEvents) {
                <option [ngValue]="ev.idEvents">{{ ev.name }} · {{ fecha(ev) | date: 'dd/MM/yy' }}</option>
              }
            </select>
          </label>
          <label>
            <span>Desde</span>
            <input class="tm-input" type="date" name="desde" [ngModel]="desde()" (ngModelChange)="desde.set($event)" />
          </label>
          <label>
            <span>Hasta</span>
            <input class="tm-input" type="date" name="hasta" [ngModel]="hasta()" (ngModelChange)="hasta.set($event)" />
          </label>
          <button type="submit" class="btn buscar"><i class="pi pi-search"></i> Buscar</button>
        </form>

        <div class="cifras" role="status">
          <div><span>Personas que pasaron</span><strong>{{ totales().personas }}</strong></div>
          <div><span>Valor de lo que pasó</span><strong>\${{ totales().monto | number: '1.2-2' }}</strong></div>
          <div><span>Escaneos</span><strong>{{ totales().escaneos }}</strong></div>
          <div><span>Deshechos</span><strong>{{ totales().deshechos }}</strong></div>
        </div>

        @if (cargando()) {
          <div class="tm-skeleton lista-sk" role="status" aria-label="Cargando historial"></div>
        } @else if (error()) {
          <p class="vacio">No se pudo cargar el historial. Intenta de nuevo.</p>
        } @else if (!escaneos().length) {
          <p class="vacio">No hay ingresos en este período.</p>
        } @else {
          @if (escaneos().length === limite) {
            <p class="aviso">Se muestran los {{ limite }} más recientes: acota las fechas para ver el resto.</p>
          }
          <ul class="lista">
            <li class="cabecera" aria-hidden="true">
              <span>Fecha y hora</span><span>Cliente</span><span>Evento</span><span>Entradas</span><span>Valor</span><span>Escaneó</span>
            </li>
            @for (s of escaneos(); track s.idScan) {
              <li [class.is-deshecho]="s.deshecho">
                <span class="cuando">
                  <strong>{{ s.fecha | date: 'h:mm a' }}</strong>
                  <small>{{ s.fecha | date: "EEE d MMM y" }}</small>
                </span>
                <span class="cliente">
                  <strong>{{ s.cliente?.nombre || 'Pago #' + s.idPayment }}</strong>
                  <small>{{ s.cliente?.cedula || '' }} · Pago #{{ s.idPayment }}</small>
                </span>
                <span class="evento">{{ s.evento || '—' }}</span>
                <span class="entradas">
                  <strong>{{ s.total }}</strong>
                  <small>{{ resumen(s) }}</small>
                </span>
                <span class="monto">\${{ (s.monto ?? 0) | number: '1.2-2' }}</span>
                <span class="quien">
                  {{ s.usuario?.nombre || '—' }}
                  @if (s.deshecho) {
                    <em class="tm-badge tm-badge--neutral">Deshecho</em>
                  } @else if (s.origen === 'manual') {
                    <em class="tm-badge tm-badge--neutral">Manual</em>
                  }
                </span>
              </li>
            }
          </ul>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .filtros {
      display: grid;
      grid-template-columns: minmax(0, 2fr) repeat(2, minmax(0, 1fr)) auto;
      align-items: end;
      gap: 0.75rem;
      margin-bottom: 1rem;

      label {
        display: grid;
        gap: 4px;

        span {
          color: var(--text-muted);
          font-size: 0.75rem;
          font-weight: 700;
        }
      }
    }

    .buscar::before {
      content: none !important;
    }

    .cifras {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.75rem;
      margin-bottom: 1rem;

      div {
        display: grid;
        gap: 0.2rem;
        padding: 0.8rem 1rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--surface);
      }

      span {
        color: var(--text-muted);
        font-size: 0.75rem;
        font-weight: 700;
      }

      strong {
        font-size: 1.35rem;
        font-variant-numeric: tabular-nums;
      }
    }

    .vacio,
    .aviso {
      margin: 0;
      padding: 1.5rem 0;
      color: var(--text-muted);
      text-align: center;
    }

    .aviso {
      padding: 0 0 0.75rem;
      text-align: left;
      font-size: 0.85rem;
    }

    .lista-sk {
      height: 320px;
      border-radius: var(--radius-md);
    }

    .lista {
      display: grid;
      gap: 0.4rem;
      margin: 0;
      padding: 0;
      list-style: none;

      li {
        display: grid;
        grid-template-columns: 120px minmax(0, 1.4fr) minmax(0, 1fr) 110px 90px minmax(0, 0.9fr);
        align-items: center;
        gap: 0.75rem;
        padding: 0.65rem 0.9rem;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--surface);
        font-size: 0.88rem;
      }

      .cabecera {
        border: 0;
        background: transparent;
        padding-block: 0;
        color: var(--text-muted);
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      span {
        display: grid;
        min-width: 0;
      }

      strong,
      small,
      .evento {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      small {
        color: var(--text-muted);
        font-size: 0.75rem;
      }

      .monto {
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }

      .quien em {
        justify-self: start;
        margin-top: 0.2rem;
        font-style: normal;
      }

      .is-deshecho {
        opacity: 0.55;

        .monto,
        .entradas strong {
          text-decoration: line-through;
        }
      }
    }

    // Móvil: cada ingreso en una tarjeta, sin scroll horizontal.
    @media (max-width: 900px) {
      .filtros {
        grid-template-columns: repeat(2, minmax(0, 1fr));

        label:first-child,
        .buscar {
          grid-column: 1 / -1;
        }
      }

      .cifras {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .lista {
        .cabecera {
          display: none;
        }

        li {
          grid-template-columns: minmax(0, 1fr) auto;
          grid-template-areas:
            'cliente monto'
            'cuando entradas'
            'evento quien';
          row-gap: 0.4rem;
        }

        .cliente {
          grid-area: cliente;
        }

        .monto {
          grid-area: monto;
          text-align: right;
        }

        .cuando {
          grid-area: cuando;
        }

        .entradas {
          grid-area: entradas;
          text-align: right;
        }

        .evento {
          grid-area: evento;
          color: var(--text-muted);
        }

        .quien {
          grid-area: quien;
          text-align: right;
          color: var(--text-muted);
        }
      }
    }
  `
})
export class EscaneosComponent {
  private http = inject(HttpClient);
  private api = environment.api;
  readonly limite = LIMITE;

  readonly eventos = toSignal(
    inject(EventsService)
      .getEvents()
      .pipe(catchError(() => of([] as Event[]))),
    { initialValue: [] as Event[] }
  );
  readonly eventosOrdenados = computed(() => [...this.eventos()].sort((a, b) => byDateAsc(b, a)));

  readonly idEvento = signal<number | null>(null);
  readonly desde = signal(hoyVe(-6));
  readonly hasta = signal(hoyVe());
  readonly escaneos = signal<Escaneo[]>([]);
  readonly cargando = signal(false);
  readonly error = signal(false);

  readonly totales = computed(() => {
    const t = { personas: 0, monto: 0, escaneos: this.escaneos().length, deshechos: 0 };
    for (const s of this.escaneos()) {
      if (s.deshecho) {
        t.deshechos++;
      } else {
        t.personas += s.total;
        t.monto += s.monto ?? 0;
      }
    }
    return t;
  });

  constructor() {
    this.cargar();
  }

  fecha(ev: Event) {
    return parseEventDate(ev.date);
  }

  resumen(s: Escaneo) {
    return s.entradas.map(e => `${e.cantidad} ${e.tipo}`).join(' · ');
  }

  cargar() {
    let params = new HttpParams().set('limit', LIMITE);
    if (this.idEvento()) params = params.set('idEvents', this.idEvento()!);
    if (this.desde()) params = params.set('desde', this.desde());
    if (this.hasta()) params = params.set('hasta', this.hasta());
    this.cargando.set(true);
    this.error.set(false);
    this.http.get<Escaneo[]>(`${this.api}/code/scans`, { params }).subscribe({
      next: lista => {
        this.escaneos.set(lista ?? []);
        this.cargando.set(false);
      },
      error: () => {
        this.cargando.set(false);
        this.error.set(true);
      }
    });
  }
}
