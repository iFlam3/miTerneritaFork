import { DecimalPipe } from '@angular/common';
import { afterNextRender, Component, computed, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { coloresZonas, MesaPlano, PlanoSalon, ZonaPlano } from '../../../@core/models/salon.model';

/**
 * Plano del salón con sus mesas y puestos, como en el cine.
 * - modo "compra": tocar un puesto lo elige; tocar el número de la mesa elige
 *   todos sus puestos libres. Los ocupados salen en gris y no se pueden tocar.
 * - modo "admin": tocar una mesa (o cualquiera de sus puestos) le asigna la zona.
 *   Con el ratón también se arrastra un rectángulo para asignar (o quitar con Alt) varias mesas.
 */
@Component({
  selector: 'app-plano-salon',
  imports: [DecimalPipe],
  template: `
    <div class="leyenda">
      @for (z of zonasUsadas(); track z.idTicket) {
        <span class="chip"><i [style.background]="z.color"></i>{{ z.name }}@if (modo() === 'compra') { · \${{ +z.price | number: '1.0-2' }}}</span>
      }
      @if (modo() === 'compra') {
        <span class="chip"><i class="sel"></i>Tu selección</span>
      }
      <span class="chip"><i class="ocu"></i>{{ modo() === 'compra' ? 'Ocupado' : 'Vendido o apartado' }}</span>
      @if (modo() === 'admin') {
        <span class="chip"><i class="res"></i>Vendido por fuera</span>
      }
      @if (haySinZona()) {
        <span class="chip"><i class="sin"></i>{{ modo() === 'compra' ? 'No disponible' : 'Sin entrada: no se vende' }}</span>
      }
    </div>

    <div class="lienzo" #lienzo>
      <svg #svg [attr.viewBox]="plano().viewBox" [class.arrastrando]="marco()" role="group"
           (pointerdown)="empezarMarco($event)" (pointermove)="moverMarco($event)" (pointerup)="soltarMarco($event)" (pointercancel)="marco.set(null)" [attr.aria-label]="modo() === 'compra' ? 'Mapa de puestos' : 'Mapa de mesas'">
        <rect class="escenario" [attr.x]="plano().escenario.x" [attr.y]="plano().escenario.y" [attr.width]="plano().escenario.w" [attr.height]="plano().escenario.h" rx="6" />
        <text class="rotulo" [attr.x]="plano().escenario.x + plano().escenario.w / 2" [attr.y]="plano().escenario.y + plano().escenario.h / 2">ESCENARIO</text>
        <rect class="barra" [attr.x]="plano().barra.x" [attr.y]="plano().barra.y" [attr.width]="plano().barra.w" [attr.height]="plano().barra.h" rx="6" />
        <text class="rotulo" [attr.x]="plano().barra.x + plano().barra.w / 2" [attr.y]="plano().barra.y + plano().barra.h / 2">BARRA</text>

        @for (m of plano().mesas; track m.mesa) {
          @let color = colorMesa(m.mesa);
          <g class="mesa" [class.sin-zona]="!color" [class.admin]="modo() === 'admin'">
            <rect class="mesa-fondo" [attr.x]="m.x" [attr.y]="m.y" [attr.width]="m.w" [attr.height]="m.h" rx="5"
                  [attr.fill]="color ?? 'transparent'" [attr.stroke]="color ?? 'currentColor'" />
            @for (a of m.asientos; track a[0]) {
              @let id = m.mesa + a[0];
              @let estado = estadoAsiento(id, color);
              <g class="asiento" [class]="'asiento ' + estado" [attr.tabindex]="estado === 'libre' || estado === 'elegido' || modo() === 'admin' ? 0 : -1"
                 role="button" [attr.aria-label]="etiqueta(m, id, estado)" [attr.aria-pressed]="estado === 'elegido'"
                 (click)="tocarAsiento(m, id, estado)" (keydown.enter)="tocarAsiento(m, id, estado)" (keydown.space)="$event.preventDefault(); tocarAsiento(m, id, estado)">
                <title>{{ etiqueta(m, id, estado) }}</title>
                <rect [attr.x]="a[1] - plano().asiento.w / 2" [attr.y]="a[2] - plano().asiento.h / 2" [attr.width]="plano().asiento.w" [attr.height]="plano().asiento.h" rx="3"
                      [attr.fill]="estado === 'libre' ? color : null" />
                <text [attr.x]="a[1]" [attr.y]="a[2]">{{ a[0] }}</text>
              </g>
            }
            <g class="numero" role="button" [attr.tabindex]="color || modo() === 'admin' ? 0 : -1"
               [attr.aria-label]="(modo() === 'compra' ? 'Elegir la mesa completa ' : 'Asignar zona a la mesa ') + m.mesa"
               (click)="tocarMesa(m.mesa)" (keydown.enter)="mesa.emit(m.mesa)">
              <title>{{ modo() === 'compra' ? 'Mesa ' + m.mesa + ': elegir la mesa completa' : 'Mesa ' + m.mesa }}</title>
              <circle [attr.cx]="m.nx" [attr.cy]="m.ny" r="9" />
              <text [attr.x]="m.nx" [attr.y]="m.ny">{{ m.mesa }}</text>
            </g>
          </g>
        }

        @if (marco(); as r) {
          <rect class="marco" [class.quitar]="r.quitar" [attr.x]="r.x" [attr.y]="r.y" [attr.width]="r.w" [attr.height]="r.h" rx="3" />
        }
      </svg>
    </div>
  `,
  styles: `
    :host {
      display: grid;
      gap: 0.75rem;
    }

    .leyenda {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem 0.9rem;
      font-size: 0.82rem;
      color: var(--text-muted);
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;

      i {
        width: 12px;
        height: 12px;
        border-radius: 3px;

        // Color inverso al tema: no se confunde con ninguna zona.
        &.sel {
          background: var(--text);
          box-shadow: 0 0 0 2px var(--primary);
        }

        &.res {
          background: #f5f5f4;
          outline: 1.5px solid #d4a017;
        }

        &.ocu {
          background: #6b7280;
          opacity: 0.55;
        }

        &.sin {
          border: 1px dashed var(--border-strong);
        }
      }
    }

    .lienzo {
      container-type: inline-size;
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface-2);
      -webkit-overflow-scrolling: touch;
    }

    svg {
      display: block;
      width: 100%;
      height: auto;
      color: var(--border-strong);
      font-family: var(--font-body);
      user-select: none;
    }

    // Si no cabe a un tamaño tocable, el plano conserva su ancho y se desplaza de lado.
    @container (max-width: 640px) {
      svg {
        width: 760px;
        max-width: none; // el reset global limita los svg al 100%
      }
    }

    .escenario,
    .barra {
      fill: var(--surface-3);
      stroke: var(--border-strong);
    }

    .rotulo {
      fill: var(--text-muted);
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-anchor: middle;
      dominant-baseline: central;
    }

    .mesa-fondo {
      fill-opacity: 0.1;
      stroke-width: 1.2;
    }

    .sin-zona .mesa-fondo {
      stroke-dasharray: 4 3;
      stroke-opacity: 0.6;
    }

    .asiento {
      cursor: pointer;
      outline: none;

      rect {
        stroke: var(--surface);
        stroke-width: 1;
        transition: fill 0.15s, opacity 0.15s;
      }

      text {
        fill: #fff;
        font-size: 7px;
        font-weight: 700;
        text-anchor: middle;
        dominant-baseline: central;
        pointer-events: none;
      }

      &.libre rect {
        fill-opacity: 0.85;
      }

      &.libre:hover rect,
      &.libre:focus-visible rect {
        fill-opacity: 1;
        stroke: var(--text);
        stroke-width: 1.5;
      }

      &.elegido {
        rect {
          fill: var(--text);
          stroke: var(--primary);
          stroke-width: 2;
        }

        text {
          fill: var(--surface);
        }
      }

      &.ocupado {
        cursor: not-allowed;

        rect {
          fill: #6b7280;
          opacity: 0.45;
        }

        text {
          fill: var(--text-subtle);
        }
      }

      &.sin-venta {
        cursor: default;

        rect {
          fill: transparent;
          stroke: currentColor;
          stroke-dasharray: 2 2;
        }

        text {
          fill: var(--text-subtle);
        }
      }
    }

    .admin .asiento {
      cursor: pointer;
    }

    .asiento.reservado rect {
      fill: #f5f5f4;
      stroke: #d4a017;
      stroke-width: 1.5;
    }

    .asiento.reservado text {
      fill: #1c1917;
    }

    .numero {
      cursor: pointer;
      outline: none;

      circle {
        fill: var(--surface);
        stroke: var(--border-strong);
      }

      text {
        fill: var(--text);
        font-size: 8.5px;
        font-weight: 700;
        text-anchor: middle;
        dominant-baseline: central;
        pointer-events: none;
      }

      &:hover circle,
      &:focus-visible circle {
        fill: var(--primary);
        stroke: var(--primary);
      }

      &:hover text,
      &:focus-visible text {
        fill: var(--primary-contrast);
      }
    }

    .marco {
      fill: var(--primary-soft);
      stroke: var(--primary);
      stroke-width: 1.5;
      stroke-dasharray: 5 3;
      pointer-events: none;

      &.quitar {
        fill: rgba(239, 68, 68, 0.12);
        stroke: #ef4444;
      }
    }

    .arrastrando {
      cursor: crosshair;
    }

    .sin-zona:not(.admin) .numero {
      cursor: default;
      pointer-events: none;
    }
  `
})
export class PlanoSalonComponent {
  plano = input.required<PlanoSalon>();
  /** { [mesa]: idTicket } */
  zonas = input<Record<number, number>>({});
  tickets = input<ZonaPlano[]>([]);
  ocupados = input<Record<string, string>>({});
  seleccion = input<string[]>([]);
  modo = input<'compra' | 'admin'>('compra');
  /** Admin: puestos vendidos por fuera (se pintan aparte). */
  porFuera = input<string[]>([]);
  /** Admin: tocar un puesto lo marca o libera por fuera en vez de asignar la mesa. */
  reservando = input(false);

  /** Puesto tocado ("5A"); solo en modo compra y si está libre o elegido. */
  asiento = output<string>();
  /** Número de mesa tocado (compra: mesa completa; admin: asignar zona). */
  mesa = output<number>();
  /** Mesas dentro del rectángulo arrastrado (solo admin); quitar = se arrastró con Alt. */
  mesas = output<{ mesas: number[]; quitar: boolean }>();

  /** Rectángulo de selección en coordenadas del plano. */
  marco = signal<{ x: number; y: number; w: number; h: number; quitar: boolean } | null>(null);
  private svg = viewChild.required<ElementRef<SVGSVGElement>>('svg');
  private inicio: { x: number; y: number; px: number; py: number } | null = null;
  /** El click que llega al soltar un arrastre no debe asignar además la mesa de debajo. */
  private trasArrastre = false;

  private colores = computed(() => coloresZonas(this.tickets()));
  private lienzo = viewChild.required<ElementRef<HTMLElement>>('lienzo');

  constructor() {
    // En pantallas chicas el plano se desplaza: arranca centrado en el escenario.
    afterNextRender(() => {
      const el = this.lienzo().nativeElement;
      el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    });
  }
  private elegidos = computed(() => new Set(this.seleccion()));

  /** Zonas que aparecen en la leyenda: las que tienen mesas (o todas en admin). */
  zonasUsadas = computed(() => {
    const usadas = new Set(Object.values(this.zonas()));
    return this.tickets()
      .filter(t => this.modo() === 'admin' || usadas.has(t.idTicket))
      .map(t => ({ ...t, color: this.colores().get(t.idTicket)! }));
  });

  haySinZona = computed(() => this.plano().mesas.some(m => !this.colorMesa(m.mesa)));

  colorMesa(mesa: number): string | null {
    const idTicket = this.zonas()[mesa];
    return idTicket ? (this.colores().get(idTicket) ?? null) : null;
  }

  private reservados = computed(() => new Set(this.porFuera()));

  estadoAsiento(id: string, color: string | null): 'libre' | 'elegido' | 'ocupado' | 'sin-venta' | 'reservado' {
    if (this.reservados().has(id)) return 'reservado';
    if (!color) return 'sin-venta';
    if (this.elegidos().has(id)) return 'elegido';
    if (this.ocupados()[id]) return 'ocupado';
    return 'libre';
  }

  etiqueta(m: MesaPlano, id: string, estado: string): string {
    const idTicket = this.zonas()[m.mesa];
    const zona = this.tickets().find(t => t.idTicket === idTicket);
    const textos: Record<string, string> = {
      libre: zona ? `${zona.name} $${Number(zona.price)}` : '',
      elegido: 'elegido',
      ocupado: 'ocupado',
      'sin-venta': 'sin vender',
      reservado: 'vendido por fuera'
    };
    return `Puesto ${id}, mesa ${m.mesa}: ${textos[estado]}`;
  }

  tocarMesa(mesa: number) {
    if (!this.trasArrastre) this.mesa.emit(mesa);
  }

  private punto(e: PointerEvent) {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(this.svg().nativeElement.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  }

  // shortcut: solo ratón; en táctil arrastrar desplaza el plano, ahí se asigna tocando.
  empezarMarco(e: PointerEvent) {
    this.trasArrastre = false;
    if (this.modo() !== 'admin' || e.pointerType !== 'mouse' || e.button !== 0) return;
    this.inicio = { ...this.punto(e), px: e.clientX, py: e.clientY };
  }

  moverMarco(e: PointerEvent) {
    const i = this.inicio;
    if (!i) return;
    // Unos píxeles de tolerancia: un click con pulso tembloroso sigue siendo click.
    if (!this.marco() && Math.hypot(e.clientX - i.px, e.clientY - i.py) < 6) return;
    if (!this.marco()) this.svg().nativeElement.setPointerCapture(e.pointerId);
    const p = this.punto(e);
    this.marco.set({ x: Math.min(i.x, p.x), y: Math.min(i.y, p.y), w: Math.abs(p.x - i.x), h: Math.abs(p.y - i.y), quitar: e.altKey });
  }

  soltarMarco(e: PointerEvent) {
    const r = this.marco();
    this.inicio = null;
    this.marco.set(null);
    if (!r) return;
    this.trasArrastre = true;
    const mesas = this.plano()
      .mesas.filter(m => m.x < r.x + r.w && m.x + m.w > r.x && m.y < r.y + r.h && m.y + m.h > r.y)
      .map(m => m.mesa);
    if (mesas.length) this.mesas.emit({ mesas, quitar: e.altKey });
  }

  tocarAsiento(m: MesaPlano, id: string, estado: string) {
    if (this.trasArrastre) return;
    if (this.modo() === 'admin') {
      if (this.reservando()) this.asiento.emit(id);
      else this.mesa.emit(m.mesa);
    } else if (estado === 'libre' || estado === 'elegido') {
      this.asiento.emit(id);
    }
  }
}
