/**
 * Frases del saludo del dashboard. Cada hora se elige una entre las que aplican
 * (por la hora, el día o los datos del momento), así el panel no se siente estático.
 */

export interface DatosFrase {
  pendientes: number;
  clientesHoy: number;
  entradas: number;
  enLinea: number;
  comprando: number;
  hayProximos: boolean;
  /** Evento más visto de la semana. */
  topEvento: string | null;
  visitasHoy: number | null;
  movilPct: number | null;
  /** Pago verificado más rápido de hoy, en minutos. */
  minutosVerificacion: number | null;
  /** Pagos rechazados en los últimos 7 días. */
  rechazados: number;
}

interface Frase {
  texto: (d: DatosFrase) => string;
  /** hora 0-23; dia 0 = domingo. Sin condición: aplica siempre. */
  si?: (d: DatosFrase, hora: number, dia: number) => boolean;
}

const pl = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const entre = (h: number, desde: number, hasta: number) => h >= desde && h < hasta;

export const FRASES: Frase[] = [
  // ---------- Según los datos del día ----------
  {
    si: d => d.pendientes > 0,
    texto: d => `Tienes ${pl(d.pendientes, 'pago esperando', 'pagos esperando')} tu visto bueno. Mientras antes, más rápido llegan las entradas.`
  },
  { si: d => d.pendientes === 0, texto: () => 'Todo al día: no hay pagos por verificar. Buen momento para planear el próximo evento.' },
  {
    si: d => d.clientesHoy > 0,
    texto: d => `Hoy ${d.clientesHoy === 1 ? 'se registró 1 cliente nuevo' : `se registraron ${d.clientesHoy} clientes nuevos`}. La casa se sigue llenando.`
  },
  {
    si: d => d.entradas > 0,
    texto: d => `Llevas ${pl(d.entradas, 'entrada vendida', 'entradas vendidas')} en total. Cada una es una noche en Mi Ternerita.`
  },
  {
    si: d => d.enLinea > 0,
    texto: d => (d.enLinea === 1 ? '1 persona está viendo la web ahora mismo.' : `${d.enLinea} personas están viendo la web ahora mismo.`)
  },
  { si: d => d.comprando > 0, texto: () => 'Alguien está comprando ahora mismo: atento a los pagos.' },
  { si: d => !d.hayProximos, texto: () => 'No hay eventos próximos en cartelera. La agenda está esperando el siguiente.' },
  { si: d => !!d.topEvento, texto: d => `El evento más visto esta semana es ${d.topEvento}.` },
  {
    si: d => !!d.visitasHoy,
    texto: d => `Hoy hubo ${pl(d.visitasHoy!, 'visita', 'visitas')} en la web. ${d.movilPct ?? 0}% desde el teléfono.`
  },
  {
    si: d => d.minutosVerificacion !== null,
    texto: d =>
      `El pago más rápido de hoy se verificó en ${d.minutosVerificacion! < 1 ? 'menos de un minuto' : pl(d.minutosVerificacion!, 'minuto', 'minutos')}. Ese es el ritmo.`
  },
  {
    si: d => d.rechazados > 0,
    texto: d => `Hay ${pl(d.rechazados, 'pago rechazado', 'pagos rechazados')} esta semana. Quizá valga la pena escribirles.`
  },

  // ---------- Mañana (6 a 12) ----------
  { si: (_, h) => entre(h, 6, 12), texto: () => 'Café en mano: aquí está el resumen de lo que pasó anoche.' },
  { si: (_, h) => entre(h, 6, 12), texto: () => 'Buen día para revisar pagos y dejar todo listo antes del mediodía.' },
  { si: (_, h) => entre(h, 6, 12), texto: () => 'Las mañanas son tranquilas en la web: buen momento para subir fotos del último evento.' },
  { si: (_, h) => entre(h, 6, 12), texto: () => 'Arranca el día. Revisa los pendientes y deja la puerta lista.' },

  // ---------- Tarde (12 a 19) ----------
  { si: (_, h) => entre(h, 12, 19), texto: () => 'La tarde es cuando más se compra. Mantén los pagos al día.' },
  { si: (_, h) => entre(h, 12, 19), texto: () => 'Hora pico en camino: la gente empieza a planear la noche.' },
  { si: (_, h) => entre(h, 12, 19), texto: () => '¿Nuevo evento? Las tardes son buenas para anunciarlo.' },
  { si: (_, h) => entre(h, 12, 19), texto: () => 'Media jornada lista. Así van las ventas de hoy.' },

  // ---------- Noche (19 a 24) ----------
  { si: (_, h) => entre(h, 19, 24), texto: () => 'Se enciende la noche en Mi Ternerita. Atento a la puerta.' },
  { si: (_, h) => entre(h, 19, 24), texto: () => 'Noche de evento: el escáner de entradas está a un clic.' },
  { si: (_, h) => entre(h, 19, 24), texto: () => 'La barra está lista y la música también. Así va la noche.' },
  { si: (_, h) => entre(h, 19, 24), texto: () => 'Cierre del día a la vista: repasa los pagos antes de irte.' },

  // ---------- Madrugada (0 a 6) ----------
  { si: (_, h) => entre(h, 0, 6), texto: () => 'Trasnochando, ¿eh? La web sigue vendiendo mientras duermes.' },
  { si: (_, h) => entre(h, 0, 6), texto: () => 'Madrugada tranquila. Mañana hay que revisar lo que entró.' },
  { si: (_, h) => entre(h, 0, 6), texto: () => 'Los búhos también compran entradas. Aquí está el resumen.' },

  // ---------- Según el día de la semana ----------
  { si: (_, __, d) => d === 1, texto: () => 'Lunes de cuentas: así cerró el fin de semana.' },
  { si: (_, __, d) => d === 2, texto: () => 'Martes de planificación: buen día para crear el próximo evento.' },
  { si: (_, __, d) => d === 3, texto: () => 'Mitad de semana. El fin de semana se vende desde hoy.' },
  { si: (_, __, d) => d === 4, texto: () => 'Jueves: arranca la cuenta regresiva del fin de semana.' },
  { si: (_, __, d) => d === 5, texto: () => '¡Viernes! Llega la ola de compras. Pagos al día.' },
  { si: (_, __, d) => d === 6, texto: () => 'Sábado de casa llena. Puerta, mesas y barra listas.' },
  { si: (_, __, d) => d === 0, texto: () => 'Domingo de descanso… o de resaca de evento. Así quedó todo.' },

  // ---------- Siempre ----------
  { texto: () => 'Este es el resumen de ventas y actividad de Mi Ternerita House.' },
  { texto: () => 'Todo lo que pasa en la casa, en un vistazo.' },
  { texto: () => 'Ventas, visitas y pagos al día. Tú pones la música.' },
  { texto: () => 'Cada entrada vendida es una mesa llena. Así vamos.' },
  { texto: () => 'Desde aquí se mueve la noche de Maracaibo.' },
  { texto: () => 'Lo de hoy, lo de la semana y lo que viene. Todo aquí.' }
];

/**
 * Frase de esta hora: las frases se barajan con la hora como semilla y gana la
 * primera que aplica. Recargar dentro de la misma hora muestra la misma frase.
 */
export function fraseDeLaHora(ahora: Date, d: DatosFrase): string {
  const hora = ahora.getHours();
  const dia = ahora.getDay();
  let semilla = ahora.getFullYear() * 1_000_000 + (ahora.getMonth() + 1) * 10_000 + ahora.getDate() * 100 + hora;
  // Generador pseudoaleatorio pequeño (mulberry32) para barajar igual toda la hora.
  const azar = () => {
    semilla = (semilla + 0x6d2b79f5) | 0;
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const orden = FRASES.map((f, i) => ({ f, k: azar(), i })).sort((a, b) => a.k - b.k);
  const elegida = orden.find(({ f }) => !f.si || f.si(d, hora, dia));
  return (elegida ?? orden[0]).f.texto(d);
}
