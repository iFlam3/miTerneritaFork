import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { environment } from '../../../environments/environment.developer';

const VISITANTE_KEY = 'mt_visitante';
const SESION_KEY = 'mt_sesion';
/** Tras 30 min sin actividad empieza otra visita. */
const SESION_MS = 30 * 60_000;
/** Latido mientras la pestaña está a la vista: así se sabe quién sigue en línea. */
const LATIDO_MS = 60_000;
/** Sin tocar la página, la visita cuenta tras este tiempo a la vista; los robots cargan y se van antes. */
const HUMANO_MS = 10_000;

export interface ResumenVisitas {
  dias: number;
  activas: number;
  comprando: number;
  visitas: number;
  visitantes: number;
  recurrentes: number;
  paginasPorVisita: number;
  rebote: number;
  duracionPromedioSeg: number | null;
  horaPico: number | null;
  porHora: number[];
  /** [lunes..domingo][hora] */
  calor: number[][];
  porDia: { fecha: string; visitas: number }[];
  dispositivos: { movil: number; escritorio: number };
  embudo: { paso: string; sesiones: number }[];
  compra: { compras: number; promedioSeg: number | null; medianaSeg: number | null };
  verificacion: {
    revisados: number;
    promedioSeg: number | null;
    medianaSeg: number | null;
    pendientes: number;
    esperaMasLargaSeg: number | null;
  };
  topEventos: { idEvents: number; nombre: string; visitas: number; compras: number }[];
}

/** UUID v4; `randomUUID` solo existe en https o localhost. */
export const uuid = (): string =>
  crypto.randomUUID?.() ??
  '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
    (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16)
  );

/** Página del sitio público → paso de la compra. `null` = no se cuenta (panel y escáner de la puerta). */
export function pasoDe(url: string): { paso: string; idEvents?: number } | null {
  const ruta = url.split(/[?#]/)[0];
  if (ruta.startsWith('/admin') || ruta.startsWith('/puerta')) return null;
  if (ruta === '/' || ruta === '') return { paso: 'inicio' };
  if (ruta === '/concierto') return { paso: 'entradas' };
  const m = /^\/home\/event\/(\d+)(\/ticket(\/consume|\/checkout(\/payment)?)?)?\/?$/.exec(ruta);
  if (!m) return { paso: 'otra' };
  const paso = !m[2] ? 'evento' : m[4] ? 'pago' : m[3] === '/consume' ? 'consumo' : m[3] ? 'datos' : 'entradas';
  return { paso, idEvents: Number(m[1]) };
}

/**
 * Visitas del sitio: registro anónimo (sin datos personales) y el resumen del
 * dashboard. El personal y el admin no cuentan como visitas.
 */
@Injectable({ providedIn: 'root' })
export class VisitasService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private api = `${environment.api}/visitas`;
  private iniciado = false;
  /** Hasta confirmar que hay una persona, las páginas vistas esperan aquí. */
  private humano = false;
  private pendientes: { paso: string; idEvents?: number }[] = [];

  iniciar() {
    if (this.iniciado) return;
    this.iniciado = true;
    this.esperarHumano();
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe(e => {
      const p = pasoDe(e.urlAfterRedirects);
      if (!p) return;
      if (this.humano) this.enviar(p.paso, p.idEvents);
      else this.pendientes.push(p);
    });
    setInterval(() => {
      if (this.humano && document.visibilityState === 'visible' && pasoDe(this.router.url)) this.enviar();
    }, LATIDO_MS);
  }

  /** La visita cuenta con la primera interacción (clic, tecla, scroll) o tras HUMANO_MS a la vista. */
  private esperarHumano() {
    const eventos = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    let visibleMs = 0;
    const reloj = setInterval(() => {
      if (document.visibilityState === 'visible') visibleMs += 1000;
      if (visibleMs >= HUMANO_MS) confirmar();
    }, 1000);
    const confirmar = () => {
      if (this.humano) return;
      this.humano = true;
      clearInterval(reloj);
      eventos.forEach(e => window.removeEventListener(e, confirmar, true));
      for (const p of this.pendientes.splice(0)) this.enviar(p.paso, p.idEvents);
    };
    eventos.forEach(e => window.addEventListener(e, confirmar, { capture: true, passive: true }));
  }

  /** Paso que no es una página: el pago enviado. */
  pagado(idEvents: number) {
    this.enviar('pagado', idEvents);
  }

  resumen(dias: number) {
    return this.http.get<ResumenVisitas>(`${this.api}/resumen`, { params: new HttpParams().set('dias', dias) });
  }

  activas() {
    return this.http.get<{ activas: number; comprando: number }>(`${this.api}/activas`);
  }

  // fetch y no HttpClient: sin interceptores (spinner de guardado, avisos de error).
  private enviar(paso?: string, idEvents?: number) {
    const ids = this.ids();
    if (!ids) return;
    fetch(this.api, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...ids, ...(paso ? { paso } : {}), ...(idEvents ? { idEvents } : {}) })
    }).catch(() => undefined);
  }

  private ids(): { visitante: string; sesion: string } | null {
    try {
      // El personal y el admin no cuentan como visitas.
      if (['admin', 'user'].includes(JSON.parse(localStorage.getItem('user') ?? 'null')?.role)) return null;
      let visitante = localStorage.getItem(VISITANTE_KEY);
      if (!visitante) {
        visitante = uuid();
        localStorage.setItem(VISITANTE_KEY, visitante);
      }
      const ahora = Date.now();
      const previa = JSON.parse(localStorage.getItem(SESION_KEY) ?? 'null') as { id: string; ultimo: number } | null;
      const sesion = previa && ahora - previa.ultimo < SESION_MS ? previa.id : uuid();
      localStorage.setItem(SESION_KEY, JSON.stringify({ id: sesion, ultimo: ahora }));
      return { visitante, sesion };
    } catch {
      return null; // almacenamiento bloqueado: no se cuenta
    }
  }
}
