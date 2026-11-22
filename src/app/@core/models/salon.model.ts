/** GET /salon/plano: el plano fijo del salón (47 mesas, 304 puestos). */
export interface MesaPlano {
  mesa: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Posición del número de la mesa. */
  nx: number;
  ny: number;
  /** [letra, x, y]: centro de cada puesto ("5" + "A" = "5A"). */
  asientos: [string, number, number][];
}

export interface PlanoSalon {
  viewBox: string;
  escenario: { x: number; y: number; w: number; h: number };
  barra: { x: number; y: number; w: number; h: number };
  asiento: { w: number; h: number };
  mesas: MesaPlano[];
}

/** GET /salon/:idEvents: zona de cada mesa y puestos tomados. */
export interface EstadoSalon {
  /** { [mesa]: idTicket } */
  zonas: Record<number, number>;
  /** Puestos que no se pueden elegir. */
  ocupados: Record<string, 'vendido' | 'apartado'>;
  /** Puestos que ya tengo apartados (al volver a esta pantalla). */
  mios: string[];
  /** Puestos vendidos por fuera desde el mapa del admin (también en `ocupados`). */
  porFuera: string[];
}

/** Una zona (tipo de entrada) para pintar el plano. */
export interface ZonaPlano {
  idTicket: number;
  name: string;
  price: number | string;
}

const PALETA = ['#10b981', '#ef4444', '#f97316', '#ec4899', '#14b8a6', '#84cc16', '#06b6d4', '#a16207'];

/**
 * Un color distinto por tipo de entrada: VIP dorado, Palco morado, General azul;
 * el resto (o un segundo Palco) toma el siguiente libre de la paleta.
 */
export function coloresZonas(tickets: { idTicket: number; name: string }[]): Map<number, string> {
  const colores = new Map<number, string>();
  const usados = new Set<string>();
  for (const t of tickets) {
    const n = t.name.toLowerCase();
    const preferido = n.includes('vip') ? '#d4a017' : n.includes('palco') ? '#8b5cf6' : n.includes('general') ? '#3b82f6' : null;
    const color =
      preferido && !usados.has(preferido) ? preferido : (PALETA.find(c => !usados.has(c)) ?? PALETA[colores.size % PALETA.length]);
    usados.add(color);
    colores.set(t.idTicket, color);
  }
  return colores;
}
