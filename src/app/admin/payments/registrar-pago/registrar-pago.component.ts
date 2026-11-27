import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MessageService } from 'primeng/api';
import { catchError, of } from 'rxjs';
import { Event } from '../../../@core/models/event.model';
import { MenuEvento, ProductoMenu } from '../../../@core/models/menu.model';
import { EstadoSalon, PlanoSalon } from '../../../@core/models/salon.model';
import { Ticket } from '../../../@core/models/ticket.model';
import { EventsService } from '../../../@core/services/events.service';
import { PaymentService } from '../../../@core/services/payment.service';
import { SalonService } from '../../../@core/services/salon.service';
import { TasaService } from '../../../@core/services/tasa.service';
import { TicketsService } from '../../../@core/services/tickets.service';
import { UsersService } from '../../../@core/services/users.service';
import { byDateAsc, eventImage, formatTime12, isPastEvent, parseEventDate } from '../../../@core/utils/event-utils';
import { BANKS } from '../../../pages/payment/payment.component';
import { PlanoSalonComponent } from '../../../shared/components/plano-salon/plano-salon.component';
import { TokenService } from '../../../@core/services/token.service';
import { environment } from '../../../../environments/environment.developer';

/** "12A" → mesa 12. */
const mesaDe = (asiento: string) => parseInt(asiento, 10);
/** Tope de entradas por registro asistido (la web limita a 10 por compra). */
const MAX_ENTRADAS = 50;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEFONO = /^[0-9+\s-]{7,15}$/;

interface Cliente {
  id?: number;
  name: string;
  lastName: string;
  cedula: string;
  email: string | null;
  phone: string | null;
}

type Metodo = 'Efectivo' | 'Pago Móvil' | 'Transferencia' | 'Zelle';

/**
 * Registro asistido de un pago: el personal compra en nombre de un cliente (por
 * ejemplo una persona mayor que no usa la web) en 6 pasos, como tarjetas que se
 * desplazan. Al final el pago queda aprobado, el QR va al correo (si lo hay) y
 * se puede compartir el enlace de la entrada por WhatsApp o imprimirla.
 */
@Component({
  selector: 'app-registrar-pago',
  imports: [FormsModule, DatePipe, DecimalPipe, RouterLink, PlanoSalonComponent],
  // Cerrar la pestaña o recargar también suelta lo apartado (ngOnDestroy no llega a correr).
  host: { '(window:pagehide)': 'soltarAlCerrar()' },
  templateUrl: './registrar-pago.component.html',
  styleUrl: './registrar-pago.component.scss'
})
export class RegistrarPagoComponent implements OnInit, OnDestroy {
  private users = inject(UsersService);
  private eventsService = inject(EventsService);
  private ticketsService = inject(TicketsService);
  private salonService = inject(SalonService);
  private payments = inject(PaymentService);
  private messages = inject(MessageService);
  private router = inject(Router);
  readonly tasa = inject(TasaService).tasa;

  readonly pasos = ['Cliente', 'Evento', 'Mesas y asientos', 'Consumo', 'Pago', 'Verificación'];
  readonly paso = signal(0);
  /** Hacia dónde se desliza la tarjeta: 'adelante' entra por la derecha. */
  readonly dir = signal<'adelante' | 'atras'>('adelante');
  readonly bancos = BANKS.map(b => b.label);
  readonly metodos: Metodo[] = ['Efectivo', 'Pago Móvil', 'Transferencia', 'Zelle'];

  // ---------- 1. Cliente ----------
  readonly tipoCed = signal<'V' | 'E' | 'J'>('V');
  readonly numCed = signal('');
  readonly buscando = signal(false);
  /** Cliente encontrado por cédula. */
  readonly cliente = signal<Cliente | null>(null);
  /** No existe: se da de alta con los datos del formulario. */
  readonly nuevo = signal(false);
  readonly nombre = signal('');
  readonly apellido = signal('');
  readonly telefono = signal('');
  readonly correo = signal('');
  readonly cedula = computed(() => `${this.tipoCed()}-${this.numCed().replace(/\D/g, '')}`);

  readonly clienteListo = computed(() => {
    if (this.cliente()) return true;
    return (
      this.nuevo() &&
      this.nombre().trim().length >= 2 &&
      this.apellido().trim().length >= 2 &&
      TELEFONO.test(this.telefono().trim()) &&
      (!this.correo().trim() || CORREO.test(this.correo().trim()))
    );
  });
  /** Lo que se mostrará en la verificación y al final. */
  readonly datosCliente = computed<Cliente>(() =>
    this.cliente() ?? {
      name: this.nombre().trim(),
      lastName: this.apellido().trim(),
      cedula: this.cedula(),
      email: this.correo().trim() || null,
      phone: this.telefono().trim()
    }
  );

  // ---------- 2. Evento ----------
  readonly eventos = signal<Event[]>([]);
  readonly evento = signal<Event | null>(null);

  // ---------- 3. Mesas y asientos ----------
  readonly tickets = signal<Ticket[]>([]);
  readonly plano = signal<PlanoSalon | null>(null);
  readonly salon = signal<EstadoSalon | null>(null);
  readonly asientos = signal<string[]>([]);
  readonly cantidadesSueltas = signal<Record<number, number>>({});
  readonly conMapa = computed(() => Object.keys(this.salon()?.zonas ?? {}).length > 0);
  /** Tipos de entrada que se venden por mesa: su cantidad sale de los puestos. */
  readonly conMesa = computed(() => new Set(Object.values(this.salon()?.zonas ?? {})));
  readonly sueltos = computed(() => this.tickets().filter(t => !this.conMesa().has(t.idTicket)));

  readonly cantidades = computed(() => {
    const zonas = this.salon()?.zonas ?? {};
    const c: Record<number, number> = {};
    for (const t of this.sueltos()) c[t.idTicket] = this.cantidadesSueltas()[t.idTicket] ?? 0;
    for (const a of this.asientos()) {
      const id = zonas[mesaDe(a)];
      if (id) c[id] = (c[id] ?? 0) + 1;
    }
    return c;
  });
  readonly entradas = computed(() =>
    this.tickets()
      .filter(t => (this.cantidades()[t.idTicket] ?? 0) > 0)
      .map(t => {
        const cantidad = this.cantidades()[t.idTicket];
        return { idTicket: t.idTicket, nombre: t.name, cantidad, total: cantidad * Number(t.price) };
      })
  );
  readonly totalEntradasN = computed(() => this.entradas().reduce((s, e) => s + e.cantidad, 0));
  /** Hasta cuándo quedan apartados los puestos y el cupo (al salir del paso 3). */
  readonly vence = signal<Date | null>(null);
  readonly apartando = signal(false);

  readonly asientosOrdenados = computed(() => [...this.asientos()].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })));

  // ---------- 4. Consumo ----------
  readonly menu = signal<MenuEvento | null>(null);
  readonly carrito = signal<Record<string, number>>({});
  readonly lineasConsumo = computed(() =>
    (this.menu()?.secciones ?? [])
      .flatMap(s => s.productos)
      .filter(p => this.qty(p) > 0)
      .map(p => ({ idFood: p.idFood, idDrinks: p.idDrinks, nombre: p.nombre, cantidad: this.qty(p), total: this.qty(p) * p.precioUsd }))
  );

  // ---------- 5. Pago ----------
  readonly metodo = signal<Metodo>('Efectivo');
  readonly bancoOrigen = signal('');
  readonly referencia = signal('');
  readonly fecha = signal(new Date().toLocaleDateString('en-CA'));
  readonly verificado = signal(false);
  readonly pagoListo = computed(() => {
    if (!this.verificado()) return false;
    if (this.metodo() === 'Efectivo') return true;
    if ((this.metodo() === 'Pago Móvil' || this.metodo() === 'Transferencia') && !this.bancoOrigen()) return false;
    return this.referencia().trim().length >= 4 && !!this.fecha();
  });

  // ---------- Totales ----------
  readonly totalUsd = computed(
    () => this.entradas().reduce((s, e) => s + e.total, 0) + this.lineasConsumo().reduce((s, l) => s + l.total, 0)
  );
  readonly totalBs = computed(() => {
    const t = this.tasa()?.valor ?? 0;
    return t ? this.totalUsd() * t : null;
  });

  // ---------- 6. Registro ----------
  readonly registrando = signal(false);
  readonly resultado = signal<{ noDocumento: string; correo: string | null; url: string; telefono: string | null } | null>(null);

  /** Se puede avanzar desde el paso actual. */
  readonly puedeSeguir = computed(() => {
    switch (this.paso()) {
      case 0: return this.clienteListo();
      case 1: return !!this.evento() && this.tickets().length > 0;
      case 2: return this.totalEntradasN() > 0;
      case 3: return true;
      case 4: return this.pagoListo();
      default: return false;
    }
  });

  ngOnInit() {
    this.eventsService.getEvents().subscribe(evs =>
      this.eventos.set((evs ?? []).filter(e => e.status === 1 && !isPastEvent(e)).sort(byDateAsc))
    );
  }

  private tokens = inject(TokenService);

  soltarAlCerrar() {
    const e = this.evento();
    if (!e || !this.vence() || this.resultado()) return;
    fetch(`${environment.api}/reservas/${e.idEvents}`, {
      method: 'DELETE',
      keepalive: true,
      headers: { Authorization: `Bearer ${this.tokens.getToken()}` }
    }).catch(() => {});
  }

  ngOnDestroy() {
    // Salir sin registrar: el cupo y los puestos vuelven a quedar libres.
    const e = this.evento();
    if (e && this.vence() && !this.resultado()) this.eventsService.soltarReserva(e.idEvents).subscribe({ error: () => {} });
  }

  // ---------- Navegación ----------
  siguiente() {
    if (!this.puedeSeguir() || this.apartando()) return;
    // Al salir del mapa se apartan los puestos (y el cupo) mientras se termina el registro.
    if (this.paso() === 2) {
      this.apartando.set(true);
      this.eventsService.reservar(this.evento()!.idEvents, this.totalEntradasN(), this.asientosOrdenados()).subscribe({
        next: r => {
          this.apartando.set(false);
          this.vence.set(new Date(r.vence));
          this.avanzar();
        },
        error: err => {
          this.apartando.set(false);
          this.refrescarSalon();
          const d = err?.error?.message;
          this.messages.add({ severity: 'warn', summary: 'No se pudieron apartar', detail: Array.isArray(d) ? d.join(', ') : d ?? 'Intenta de nuevo', life: 7000 });
        }
      });
      return;
    }
    this.avanzar();
  }

  private avanzar() {
    this.dir.set('adelante');
    this.paso.update(p => Math.min(p + 1, this.pasos.length - 1));
    if (this.paso() === 2) this.refrescarSalon();
  }

  atras() {
    this.dir.set('atras');
    this.paso.update(p => Math.max(p - 1, 0));
  }

  /** Volver a un paso ya hecho desde la barra de progreso o la verificación. */
  irA(i: number) {
    if (i >= this.paso() || this.resultado()) return;
    this.dir.set('atras');
    this.paso.set(i);
  }

  // ---------- 1. Cliente ----------
  buscar() {
    const digitos = this.numCed().replace(/\D/g, '');
    if (digitos.length < 5) {
      this.messages.add({ severity: 'warn', summary: 'Escribe la cédula completa' });
      return;
    }
    this.buscando.set(true);
    this.cliente.set(null);
    this.nuevo.set(false);
    this.users.searchUserByCedula(encodeURIComponent(this.cedula())).subscribe({
      next: (u: any) => {
        this.buscando.set(false);
        this.cliente.set({ id: u.id, name: u.name, lastName: u.lastName, cedula: u.cedula, email: u.email ?? null, phone: u.phone ?? null });
      },
      error: () => {
        this.buscando.set(false);
        this.nuevo.set(true);
      }
    });
  }

  cambiarCliente() {
    this.cliente.set(null);
    this.nuevo.set(false);
    this.numCed.set('');
  }

  // ---------- 2. Evento ----------
  elegirEvento(e: Event) {
    const previo = this.evento();
    if (previo?.idEvents === e.idEvents) return;
    // Cambio de evento: lo apartado en el anterior se suelta.
    if (previo && this.vence()) {
      this.eventsService.soltarReserva(previo.idEvents).subscribe({ error: () => {} });
      this.vence.set(null);
    }
    this.evento.set(e);
    this.tickets.set([]);
    this.salon.set(null);
    this.asientos.set([]);
    this.cantidadesSueltas.set({});
    this.menu.set(null);
    this.carrito.set({});
    this.ticketsService
      .getTicktesByEvent(e.idEvents)
      .pipe(catchError(() => of([] as Ticket[])))
      .subscribe(t => this.tickets.set((t ?? []).filter(x => x.status === 1)));
    this.salonService.plano$.subscribe(p => this.plano.set(p));
    this.refrescarSalon();
    this.eventsService
      .getMenu(e.idEvents)
      .pipe(catchError(() => of(null)))
      .subscribe(m => this.menu.set(m && m.consumo ? m : null));
  }

  flyer(e: Event) {
    return eventImage(e.flyer || e.image1) || 'assets/img/optimized/fondo1.webp';
  }

  /** Evento sin foto (o que no carga): la portada de marca. */
  sinFoto(ev: globalThis.Event) {
    const img = ev.target as HTMLImageElement;
    if (!img.src.endsWith('fondo1.webp')) img.src = 'assets/img/optimized/fondo1.webp';
  }

  dia(e: Event) {
    return parseEventDate(e.date);
  }

  hora(e: Event | null) {
    return formatTime12(e?.time);
  }

  // ---------- 3. Mesas y asientos ----------
  refrescarSalon() {
    const e = this.evento();
    if (!e) return;
    this.salonService
      .estado(e.idEvents)
      .pipe(catchError(() => of(null)))
      .subscribe(estado => {
        if (!estado) return;
        const perdidos = this.asientos().filter(a => estado.ocupados[a]);
        if (perdidos.length) {
          this.asientos.update(s => s.filter(a => !estado.ocupados[a]));
          this.messages.add({ severity: 'warn', summary: 'Puestos tomados', detail: `${perdidos.join(', ')} ya no están libres.` });
        }
        this.salon.set(estado);
      });
  }

  onAsiento(id: string) {
    if (this.asientos().includes(id)) this.asientos.update(s => s.filter(a => a !== id));
    else if (this.totalEntradasN() >= MAX_ENTRADAS) this.avisoTope();
    else this.asientos.update(s => [...s, id]);
  }

  onMesa(mesa: number) {
    const ocupados = this.salon()?.ocupados ?? {};
    const libres = (this.plano()?.mesas.find(m => m.mesa === mesa)?.asientos ?? []).map(a => mesa + a[0]).filter(id => !ocupados[id]);
    const faltan = libres.filter(id => !this.asientos().includes(id));
    if (!libres.length) this.messages.add({ severity: 'info', summary: `Mesa ${mesa}`, detail: 'No tiene puestos libres.' });
    else if (!faltan.length) this.asientos.update(s => s.filter(a => !libres.includes(a)));
    else if (this.totalEntradasN() + faltan.length > MAX_ENTRADAS) this.avisoTope();
    else this.asientos.update(s => [...s, ...faltan]);
  }

  /** Arrastre sobre el mapa: toma (o suelta) los puestos libres de esas mesas. */
  onMesas(ev: { mesas: number[]; quitar: boolean }) {
    for (const m of ev.mesas) {
      const tiene = this.asientos().some(a => mesaDe(a) === m);
      if (ev.quitar ? tiene : !tiene) this.onMesa(m);
    }
  }

  cantidad(t: Ticket) {
    return this.cantidades()[t.idTicket] ?? 0;
  }

  sumar(t: Ticket, delta: number) {
    if (delta > 0 && this.totalEntradasN() >= MAX_ENTRADAS) return this.avisoTope();
    this.cantidadesSueltas.update(q => ({ ...q, [t.idTicket]: Math.max((q[t.idTicket] ?? 0) + delta, 0) }));
  }

  private avisoTope() {
    this.messages.add({ severity: 'warn', summary: `Máximo ${MAX_ENTRADAS} entradas por registro` });
  }

  // ---------- 4. Consumo ----------
  private clave(p: ProductoMenu) {
    return p.idFood ? `f${p.idFood}` : `d${p.idDrinks}`;
  }

  qty(p: ProductoMenu) {
    return this.carrito()[this.clave(p)] ?? 0;
  }

  sumarProducto(p: ProductoMenu, delta: number) {
    const k = this.clave(p);
    this.carrito.update(c => ({ ...c, [k]: Math.min(Math.max((c[k] ?? 0) + delta, 0), 50) }));
  }

  // ---------- 6. Registrar ----------
  registrar() {
    if (this.registrando()) return;
    this.registrando.set(true);
    const c = this.cliente();
    if (c?.id) {
      this.crearPago(c.id);
      return;
    }
    this.users
      .crearClienteRapido({
        name: this.nombre().trim(),
        lastName: this.apellido().trim(),
        cedula: this.cedula(),
        phone: this.telefono().trim(),
        ...(this.correo().trim() ? { email: this.correo().trim() } : {})
      })
      .subscribe({
        next: u => {
          // Si el pago falla, reintentar no vuelve a crear el cliente.
          this.cliente.set({ id: u.id, name: u.name, lastName: u.lastName, cedula: u.cedula, email: u.email, phone: u.phone });
          this.nuevo.set(false);
          this.crearPago(u.id);
        },
        error: err => this.fallo('No se pudo crear el cliente', err)
      });
  }

  private crearPago(idUser: number) {
    const e = this.evento()!;
    const m = this.metodo();
    const banco = m === 'Efectivo' ? 'Efectivo' : m === 'Zelle' ? 'Zelle' : this.bancoOrigen();
    const payload: Record<string, unknown> = {
      idEvents: e.idEvents,
      idUser,
      banco,
      referencia: m === 'Efectivo' ? 'Pago en efectivo' : this.referencia().trim(),
      items: this.entradas().map(x => ({ idTicket: x.idTicket, cantidad: x.cantidad })),
      consumos: this.lineasConsumo().map(l => ({ ...(l.idFood ? { idFood: l.idFood } : { idDrinks: l.idDrinks }), cantidad: l.cantidad })),
      asientos: this.asientosOrdenados()
    };
    if (m !== 'Efectivo' && this.fecha()) payload['fechaTransferencia'] = this.fecha();

    this.payments.createPayment(payload).subscribe({
      next: (pago: any) => {
        this.payments.enlaceEntrada(pago.idPayment).subscribe({
          next: ({ firma }) => this.terminar(pago, `${location.origin}/entrada/${firma}`),
          // El pago ya está hecho: sin enlace se puede reenviar el QR desde Pagos.
          error: () => this.terminar(pago, '')
        });
      },
      error: err => this.fallo('No se pudo registrar el pago', err)
    });
  }

  private terminar(pago: any, url: string) {
    const c = this.datosCliente();
    this.registrando.set(false);
    this.resultado.set({ noDocumento: pago.noDocumento, correo: c.email, url, telefono: c.phone });
    this.dir.set('adelante');
    this.paso.set(this.pasos.length);
  }

  private fallo(summary: string, err: any) {
    this.registrando.set(false);
    const d = err?.error?.message;
    this.messages.add({ severity: 'error', summary, detail: Array.isArray(d) ? d.join(', ') : d ?? 'Intenta de nuevo', life: 8000 });
  }

  // ---------- Compartir ----------
  /** Enlace de WhatsApp al teléfono del cliente (venezolano: 0414... → 58414...). */
  whatsapp() {
    const r = this.resultado();
    if (!r) return '';
    const texto = encodeURIComponent(
      `Hola ${this.datosCliente().name}, esta es tu entrada para ${this.evento()?.name} en Mi Ternerita House. Muéstrala en la puerta: ${r.url}`
    );
    let tel = (r.telefono ?? '').replace(/\D/g, '');
    if (tel.startsWith('0')) tel = '58' + tel.slice(1);
    return `https://wa.me/${tel.length >= 11 ? tel : ''}?text=${texto}`;
  }

  async copiar() {
    const url = this.resultado()?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.messages.add({ severity: 'success', summary: 'Enlace copiado' });
    } catch {
      this.messages.add({ severity: 'warn', summary: 'No se pudo copiar', detail: url });
    }
  }

  async compartir() {
    const r = this.resultado();
    if (!r?.url) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Tu entrada · Mi Ternerita House', url: r.url });
      } catch {
        /* cancelado */
      }
    } else {
      this.copiar();
    }
  }

  get puedeCompartirNativo() {
    return typeof navigator !== 'undefined' && !!navigator.share;
  }

  otro() {
    this.router.navigateByUrl('/admin/payments', { skipLocationChange: true }).then(() => this.router.navigateByUrl('/admin/payments/registrar'));
  }
}
