import { DatePipe, DecimalPipe, DOCUMENT, Location } from '@angular/common';
import { Router } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, ElementRef, HostListener, inject, OnDestroy, signal, viewChild } from '@angular/core';
import { environment } from '../../../environments/environment.developer';
import { puedeEscanear } from '../../@core/auth/roles';
import { Event as Evento } from '../../@core/models/event.model';
import { User } from '../../@core/models/user.model';
import { AuthService } from '../../@core/services/auth.service';
import { uuid } from '../../@core/services/visitas.service';
import { formatTime12, parseEventDate } from '../../@core/utils/event-utils';

/** Respuestas de /code (CodeService del back). */
interface Linea {
  idTicket: number;
  tipo: string;
  cantidad: number;
}
interface TipoEntrada extends Linea {
  usadas: number;
  restantes: number;
}
interface Escaneo {
  idScan: number;
  origen: string;
  fecha: string;
  total: number;
  idPayment: number;
  usuario: { nombre: string } | null;
  deshecho: boolean;
  entradas: Linea[];
  cliente?: { nombre: string; cedula: string | null } | null;
  monto?: number;
}
interface Ficha {
  noDocumento: string | null;
  buyerName: string;
  buyerEmail: string;
  buyerCedula: string | null;
  buyerPhone: string | null;
  eventName: string;
  eventDate: string;
  ticketCount: number;
  restantes: number;
  agotada: boolean;
  montoPagado: number;
  entradas: TipoEntrada[];
  consumo: { nombre: string; cantidad: number; total: number }[];
  asientos: string[];
  historial: Escaneo[];
}
interface Resultado {
  tono: 'ok' | 'aviso' | 'error';
  titulo: string;
  detalle?: string;
  idScan?: number;
}
interface Lector {
  leer(video: HTMLVideoElement): Promise<string | null>;
  cerrar(): void;
}
type Camara = 'apagada' | 'iniciando' | 'activa' | 'permiso' | 'sin-camara' | 'error';

const EVENTO_KEY = 'tm-puerta-evento';
const SONIDO_KEY = 'tm-puerta-sonido';
/** Tras cerrar una ficha, el mismo QR (que sigue delante de la cámara) se ignora este tiempo. */
const REPETIDO_MS = 4000;
const SESION_VENCIDA = 'Tu sesión venció: ingresa de nuevo.';

const leerLS = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const guardarLS = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // modo privado: solo dura esta sesión
  }
};
const mensaje = (e: HttpErrorResponse): string => [e.error?.message].flat().filter(Boolean).join(', ');
const fechaLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Eventos activos de hoy y mañana, como la app de la puerta. La jornada cambia a
 * las 6:00: de madrugada sigue saliendo el evento de anoche.
 */
export function eventosDePuerta(eventos: Evento[], ahora = new Date()): Evento[] {
  const base = new Date(ahora.getTime() - 6 * 3_600_000);
  const dias = [0, 1].map(n => fechaLocal(new Date(base.getFullYear(), base.getMonth(), base.getDate() + n)));
  return eventos
    .filter(e => e.status === 1 && dias.includes(String(e.date).slice(0, 10)))
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
}

/**
 * BarcodeDetector nativo si lee QR (Android, macOS). Si no (iPhone, Firefox, Chrome
 * en Windows), qr-scanner con su worker: solo se descarga en ese caso.
 */
async function crearLector(): Promise<Lector> {
  const Nativo = (window as any).BarcodeDetector;
  if ((await Nativo?.getSupportedFormats?.())?.includes('qr_code')) {
    const detector = new Nativo({ formats: ['qr_code'] });
    return { leer: async video => (await detector.detect(video))[0]?.rawValue ?? null, cerrar: () => {} };
  }
  const { default: QrScanner } = await import('qr-scanner');
  const motor = await QrScanner.createQrEngine();
  const canvas = document.createElement('canvas');
  return {
    leer: video => {
      // Igual que QrScanner: el cuadrado central (2/3 del lado menor) reducido a 400 px.
      const lado = Math.round((Math.min(video.videoWidth, video.videoHeight) * 2) / 3);
      const scanRegion = {
        x: Math.round((video.videoWidth - lado) / 2),
        y: Math.round((video.videoHeight - lado) / 2),
        width: lado,
        height: lado,
        downScaledWidth: 400,
        downScaledHeight: 400
      };
      return QrScanner.scanImage(video, { qrEngine: motor, canvas, scanRegion, returnDetailedScanResult: true }).then(
        r => r.data,
        () => null
      );
    },
    cerrar: () => (motor as Worker).terminate?.()
  };
}

/**
 * Escáner de la puerta (la app Expo, en la web): el personal elige el evento,
 * escanea el QR (o escribe el código), ve la ficha del comprador y deja pasar a
 * las personas que toque. Instalable como app solo desde aquí (puerta.webmanifest).
 */
@Component({
  selector: 'app-puerta',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './puerta.component.html',
  styleUrl: './puerta.component.scss'
})
export class PuertaComponent implements OnDestroy {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private doc = inject(DOCUMENT);
  private router = inject(Router);
  private location = inject(Location);
  private api = environment.api;

  readonly usuario = signal<User | null>(this.auth.isAuthenticated() ? this.auth.getUser() : null);
  readonly personal = computed(() => puedeEscanear(this.usuario()?.role));
  readonly esAdmin = computed(() => this.usuario()?.role === 'admin');
  readonly nombre = computed(() => `${this.usuario()?.name ?? ''} ${this.usuario()?.lastName ?? ''}`.trim() || 'Personal');
  readonly errorIngreso = signal('');
  readonly verClave = signal(false);

  /** null mientras cargan. */
  readonly eventos = signal<Evento[] | null>(null);
  readonly errorEventos = signal(false);
  readonly idEvento = signal<number | null>(null);
  readonly camara = signal<Camara>('apagada');
  readonly fase = signal<'escaneando' | 'buscando' | 'ficha' | 'pasando' | 'resultado'>('escaneando');
  readonly ficha = signal<Ficha | null>(null);
  readonly cantidades = signal<Record<number, number>>({});
  readonly total = computed(() => Object.values(this.cantidades()).reduce((s, n) => s + n, 0));
  readonly errorFicha = signal('');
  readonly resultado = signal<Resultado | null>(null);
  readonly historial = signal<Escaneo[]>([]);
  /** Lo que paso de verdad (sin los deshechos) en los escaneos cargados. */
  readonly totalHistorial = computed(() =>
    this.historial()
      .filter(s => !s.deshecho)
      .reduce((t, s) => ({ personas: t.personas + s.total, monto: t.monto + (s.monto ?? 0) }), { personas: 0, monto: 0 })
  );
  readonly sonido = signal(leerLS(SONIDO_KEY) !== '0');
  readonly instalable = signal<{ prompt(): Promise<unknown> } | null>(null);

  readonly fechaEvento = parseEventDate;
  readonly hora = formatTime12;

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private readonly codigo = viewChild<ElementRef<HTMLInputElement>>('codigo');
  private readonly accion = viewChild<ElementRef<HTMLButtonElement>>('accion');

  private token = '';
  private scanId = '';
  private ignorar = { token: '', hasta: 0 };
  private stream: MediaStream | null = null;
  /** Sube al apagar: una cámara o una lectura que llega tarde se descarta. */
  private intento = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private lector?: Promise<Lector>;
  private audio?: AudioContext;
  private readonly quitarCabecera = this.ponerCabecera();

  constructor() {
    // El botón principal de la ficha o del resultado recibe el foco (teclado, lector de pantalla).
    effect(() => this.accion()?.nativeElement.focus({ preventScroll: true }));
    if (this.personal()) this.cargarEventos();
  }

  ngOnDestroy() {
    this.apagarCamara();
    this.lector?.then(l => l.cerrar(), () => {});
    this.audio?.close().catch(() => {});
    this.quitarCabecera();
  }

  // ---------- Sesión ----------

  ingresar(e: SubmitEvent) {
    e.preventDefault();
    const datos = new FormData(e.target as HTMLFormElement);
    this.errorIngreso.set('');
    this.auth.login({ email: String(datos.get('email') ?? '').trim(), password: String(datos.get('password') ?? '') }).subscribe({
      next: u => {
        if (!puedeEscanear(u.role)) {
          this.auth.logout();
          this.errorIngreso.set('Esta app es solo para el personal del local.');
          return;
        }
        this.usuario.set(u);
        this.cargarEventos();
      },
      error: (err: HttpErrorResponse) =>
        this.errorIngreso.set(err.status === 0 ? 'No se pudo conectar con el servidor.' : mensaje(err) || 'Correo o contraseña incorrectos.')
    });
  }

  /**
   * Volver sin cerrar sesion: a la pagina anterior si se llego desde la web;
   * en la app instalada (abre directo en /puerta) al panel o al inicio.
   */
  volver() {
    // Hubo otra pantalla de la web antes de /puerta: se vuelve a ella.
    if (this.router.lastSuccessfulNavigation?.previousNavigation) {
      this.location.back();
    } else {
      this.router.navigateByUrl(this.esAdmin() ? '/admin/payments' : '/');
    }
  }

  salir(motivo = '') {
    this.apagarCamara();
    this.auth.logout();
    this.usuario.set(null);
    this.eventos.set(null);
    this.idEvento.set(null);
    this.historial.set([]);
    this.ficha.set(null);
    this.resultado.set(null);
    this.fase.set('escaneando');
    this.errorIngreso.set(motivo);
  }

  // ---------- Evento ----------

  cargarEventos() {
    this.errorEventos.set(false);
    this.http.get<Evento[]>(`${this.api}/events`).subscribe({
      next: todos => {
        const lista = eventosDePuerta(todos);
        this.eventos.set(lista);
        const guardado = Number(leerLS(EVENTO_KEY));
        const id = lista.some(e => e.idEvents === guardado) ? guardado : lista.length === 1 ? lista[0].idEvents : null;
        if (id) this.elegirEvento(id);
      },
      error: () => this.errorEventos.set(true)
    });
  }

  elegirEvento(id: number) {
    this.idEvento.set(id || null);
    guardarLS(EVENTO_KEY, String(id));
    this.historial.set([]);
    this.cargarHistorial();
    this.encenderCamara();
  }

  // ---------- Cámara ----------

  async encenderCamara() {
    const video = this.video()?.nativeElement;
    if (!video || !this.idEvento() || this.stream || this.camara() === 'iniciando' || this.doc.hidden) return;
    const intento = ++this.intento;
    this.camara.set('iniciando');
    try {
      this.lector ??= crearLector().catch(e => {
        this.lector = undefined;
        throw e;
      });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (intento !== this.intento) return stream.getTracks().forEach(t => t.stop());
      this.stream = stream;
      video.srcObject = stream;
      await video.play();
      const lector = await this.lector;
      if (intento !== this.intento) return;
      this.camara.set('activa');
      this.bucle(video, lector, intento);
    } catch (e) {
      if (intento !== this.intento) return;
      this.apagarCamara();
      const nombre = (e as Error)?.name;
      this.camara.set(
        nombre === 'NotAllowedError' || nombre === 'SecurityError'
          ? 'permiso'
          : nombre === 'NotFoundError' || nombre === 'OverconstrainedError' || !navigator.mediaDevices
            ? 'sin-camara'
            : 'error'
      );
    }
  }

  private apagarCamara() {
    this.intento++;
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    const video = this.video()?.nativeElement;
    if (video) video.srcObject = null;
    this.camara.set('apagada');
  }

  private bucle(video: HTMLVideoElement, lector: Lector, intento: number) {
    const paso = async () => {
      if (this.fase() === 'escaneando' && video.readyState >= 2) {
        const texto = await lector.leer(video).catch(() => null);
        if (texto && intento === this.intento && !(texto.trim() === this.ignorar.token && Date.now() < this.ignorar.hasta)) {
          this.buscar(texto);
        }
      }
      if (intento === this.intento) this.timer = setTimeout(paso, 120);
    };
    void paso();
  }

  @HostListener('document:visibilitychange')
  visibilidad() {
    if (this.doc.hidden) this.apagarCamara();
    else this.encenderCamara();
  }

  // ---------- Escaneo ----------

  /** Coincidencias de la busqueda manual (varias compras con la misma cedula). */
  readonly resultados = signal<{ token: string; nombre: string; cedula: string | null; noDocumento: string | null }[]>([]);
  readonly errorManual = signal('');

  /** Sin camara: cedula del comprador o numero de compra (o un token pegado). */
  manual(e: SubmitEvent) {
    e.preventDefault();
    const q = (this.codigo()?.nativeElement.value ?? '').trim();
    const idEvents = this.idEvento();
    this.resultados.set([]);
    this.errorManual.set('');
    if (!q || !idEvents || this.fase() !== 'escaneando') return;
    if (q.length >= 32) {
      this.buscar(q);
      return;
    }
    this.http.post<ReturnType<typeof this.resultados>>(`${this.api}/code/buscar`, { q, idEvents }).subscribe({
      next: lista => {
        if (lista.length === 1) this.elegir(lista[0].token);
        else if (lista.length) this.resultados.set(lista);
        else this.errorManual.set('No hay entradas aprobadas con esa cédula o número de compra en este evento.');
      },
      error: () => this.errorManual.set('No se pudo buscar. Revisa la conexión e intenta de nuevo.')
    });
  }

  elegir(token: string) {
    this.resultados.set([]);
    const input = this.codigo()?.nativeElement;
    if (input) input.value = '';
    this.buscar(token);
  }

  buscar(texto: string) {
    const token = texto.trim();
    const idEvents = this.idEvento();
    if (!token || !idEvents || this.fase() !== 'escaneando') return;
    this.fase.set('buscando');
    this.token = token;
    // Uno por escaneo: si "Dejar pasar" se reintenta, el back no descuenta dos veces.
    this.scanId = uuid();
    this.http.post<Ficha>(`${this.api}/code/lookup`, { token, idEvents }).subscribe({
      next: ficha => {
        this.ficha.set(ficha);
        this.cantidades.set(Object.fromEntries(ficha.entradas.map(t => [t.idTicket, Math.max(t.restantes, 0)])));
        this.errorFicha.set('');
        this.fase.set('ficha');
        const input = this.codigo()?.nativeElement;
        if (input) input.value = '';
        this.avisar(!ficha.agotada);
      },
      error: (e: HttpErrorResponse) => this.fallo(e, 'QR inválido o no encontrado')
    });
  }

  cantidad(t: TipoEntrada) {
    return this.cantidades()[t.idTicket] ?? 0;
  }

  cambiar(t: TipoEntrada, delta: number) {
    this.cantidades.update(c => ({ ...c, [t.idTicket]: Math.min(t.restantes, Math.max(0, (c[t.idTicket] ?? 0) + delta)) }));
  }

  dejarPasar() {
    const ficha = this.ficha();
    const idEvents = this.idEvento();
    const entradas = Object.entries(this.cantidades())
      .map(([idTicket, cantidad]) => ({ idTicket: Number(idTicket), cantidad }))
      .filter(e => e.cantidad > 0);
    if (!ficha || !idEvents || !entradas.length || this.fase() !== 'ficha') return;
    this.fase.set('pasando');
    this.errorFicha.set('');
    this.http
      .post<{ totalAprobadas: number; idScan: number }>(`${this.api}/code/redeem`, { token: this.token, idEvents, entradas, scanId: this.scanId })
      .subscribe({
        next: r => {
          const n = r.totalAprobadas;
          this.resultado.set({ tono: 'ok', titulo: `Pasan ${n} ${n === 1 ? 'entrada' : 'entradas'}`, detalle: ficha.buyerName, idScan: r.idScan });
          this.fase.set('resultado');
          this.avisar(true);
          this.cargarHistorial();
        },
        error: (e: HttpErrorResponse) => {
          if (e.status !== 0) return this.fallo(e, 'No se pudo registrar el ingreso. Escanea de nuevo.');
          // Sin red: se reintenta con el mismo scanId; si el primero llegó, el back no descuenta otra vez.
          this.fase.set('ficha');
          this.errorFicha.set('Sin conexión. Toca «Dejar pasar» para reintentar: no se descuenta dos veces.');
          this.avisar(false);
        }
      });
  }

  cerrar() {
    if (this.fase() === 'buscando' || this.fase() === 'pasando') return;
    this.ignorar = { token: this.token, hasta: Date.now() + REPETIDO_MS };
    this.ficha.set(null);
    this.resultado.set(null);
    this.fase.set('escaneando');
  }

  @HostListener('document:keydown.escape')
  escape() {
    if (this.fase() === 'ficha' || this.fase() === 'resultado') this.cerrar();
  }

  // ---------- Historial ----------

  cargarHistorial() {
    const idEvents = this.idEvento();
    if (!idEvents) return;
    this.http.get<Escaneo[]>(`${this.api}/code/scans`, { params: { idEvents, limit: 50 } }).subscribe({
      next: h => {
        if (idEvents === this.idEvento()) this.historial.set(h);
      },
      error: (e: HttpErrorResponse) => e.status === 401 && this.salir(SESION_VENCIDA)
    });
  }

  deshacer(idScan: number) {
    if (!confirm('¿Deshacer este escaneo? Sus entradas vuelven a quedar disponibles.')) return;
    this.http.post<{ totalDevueltas: number }>(`${this.api}/code/scans/${idScan}/undo`, {}).subscribe({
      next: r => {
        const n = r.totalDevueltas;
        this.resultado.set({ tono: 'aviso', titulo: 'Escaneo deshecho', detalle: `${n} ${n === 1 ? 'entrada vuelve' : 'entradas vuelven'} a estar disponibles.` });
        this.fase.set('resultado');
        this.avisar(true);
        this.cargarHistorial();
      },
      error: (e: HttpErrorResponse) => this.fallo(e, 'No se pudo deshacer el escaneo')
    });
  }

  resumen(lineas: Linea[]) {
    return lineas.map(l => `${l.tipo} ${l.cantidad}`).join(' · ');
  }

  /** 409/403 son reglas del negocio (otro evento, agotada, fuera de plazo): aviso con el motivo del back. */
  private fallo(e: HttpErrorResponse, porDefecto: string) {
    if (e.status === 401) return this.salir(SESION_VENCIDA);
    const conflicto = e.status === 409 || e.status === 403;
    this.resultado.set({
      tono: conflicto ? 'aviso' : 'error',
      titulo: e.status === 0 ? 'Sin conexión con el servidor' : (conflicto && mensaje(e)) || porDefecto,
      detalle: this.ficha()?.buyerName
    });
    this.fase.set('resultado');
    this.avisar(false);
  }

  // ---------- Vibración y sonido ----------

  alternarSonido() {
    this.sonido.update(v => !v);
    guardarLS(SONIDO_KEY, this.sonido() ? '1' : '0');
  }

  /** iOS solo deja sonar un AudioContext creado o reanudado en un toque. */
  @HostListener('document:click')
  desbloquearAudio() {
    if (!this.sonido() || this.audio?.state === 'running') return;
    try {
      (this.audio ??= new AudioContext()).resume().catch(() => {});
    } catch {
      // navegador sin Web Audio: solo vibración
    }
  }

  private avisar(bien: boolean) {
    // Antes del primer toque Chrome bloquea la vibración y lo anota como error en la consola.
    if (navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.(bien ? 80 : [200, 80, 200]);
    if (!this.sonido() || this.audio?.state !== 'running') return;
    const osc = this.audio.createOscillator();
    const volumen = this.audio.createGain();
    osc.type = bien ? 'sine' : 'square';
    osc.frequency.value = bien ? 880 : 200;
    volumen.gain.value = bien ? 0.2 : 0.1;
    osc.connect(volumen).connect(this.audio.destination);
    osc.start();
    osc.stop(this.audio.currentTime + (bien ? 0.12 : 0.4));
  }

  // ---------- Instalación (PWA) ----------

  @HostListener('window:beforeinstallprompt', ['$event'])
  guardarInstalacion(e: Event) {
    e.preventDefault();
    this.instalable.set(e as unknown as { prompt(): Promise<unknown> });
  }

  instalar() {
    this.instalable()?.prompt();
    this.instalable.set(null);
  }

  /**
   * Manifest e iconos de la app de la puerta solo mientras se está aquí: instalar
   * desde /puerta abre el escáner a pantalla completa y el resto del sitio no cambia.
   */
  private ponerCabecera(): () => void {
    const head = this.doc.head;
    const previo = head.querySelector('link[rel="manifest"]');
    previo?.remove();
    const tags = [
      { rel: 'manifest', href: 'puerta.webmanifest' },
      { rel: 'apple-touch-icon', href: 'puerta-180.png' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-title', content: 'Puerta' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black' }
    ].map(attrs => {
      const el = this.doc.createElement('rel' in attrs ? 'link' : 'meta');
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      return head.appendChild(el);
    });
    return () => {
      tags.forEach(t => t.remove());
      if (previo) head.appendChild(previo);
    };
  }
}
