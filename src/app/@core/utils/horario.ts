/**
 * Horario del local (solo informativo: la web vende las 24 h). Lo edita el admin en
 * Configuración y lo devuelve GET /configuration como `horario`: 7 días, de lunes a domingo.
 */
export interface DiaHorario {
  cerrado: boolean;
  /** "HH:MM" en 24 h; si cierra antes de abrir, cierra de madrugada del día siguiente. */
  abre: string;
  cierra: string;
}

export const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DIAS_SCHEMA = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Si la configuración aún no lo trae (migración sin aplicar). */
export const HORARIO_PREDETERMINADO: DiaHorario[] = [
  { cerrado: true, abre: '12:00', cierra: '23:00' },
  { cerrado: false, abre: '12:00', cierra: '23:00' },
  { cerrado: false, abre: '12:00', cierra: '23:00' },
  { cerrado: false, abre: '12:00', cierra: '23:00' },
  { cerrado: false, abre: '12:00', cierra: '03:00' },
  { cerrado: false, abre: '12:00', cierra: '03:00' },
  { cerrado: false, abre: '12:00', cierra: '23:00' }
];

export function horarioValido(h: unknown): DiaHorario[] {
  return Array.isArray(h) && h.length === 7 ? (h as DiaHorario[]) : HORARIO_PREDETERMINADO;
}

/** "12:00" → "12 m", "23:00" → "11 pm", "03:30" → "3:30 am", "00:00" → "12 am". */
export function hora12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (h === 12 && m === 0) return '12 m';
  const sufijo = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 || 12;
  return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''} ${sufijo}`;
}

/** Índice de hoy en el horario (0 = lunes). */
export const diaDeHoy = (fecha = new Date()) => (fecha.getDay() + 6) % 7;

const texto = (d: DiaHorario) => (d.cerrado ? 'Cerrado' : `${hora12(d.abre)} – ${hora12(d.cierra)}`);

/** Días seguidos con el mismo horario juntos: "Martes – Jueves · 12 m – 11 pm". */
export function agruparHorario(horario: DiaHorario[]): { dias: string; horas: string }[] {
  const grupos: { desde: number; hasta: number; horas: string }[] = [];
  horario.forEach((d, i) => {
    const horas = texto(d);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.horas === horas && ultimo.hasta === i - 1) ultimo.hasta = i;
    else grupos.push({ desde: i, hasta: i, horas });
  });
  return grupos.map(g => ({ dias: g.desde === g.hasta ? DIAS[g.desde] : `${DIAS[g.desde]} – ${DIAS[g.hasta]}`, horas: g.horas }));
}

/** Para los datos estructurados de Google (schema.org openingHoursSpecification). */
export function horarioSchema(horario: DiaHorario[]) {
  return horario.flatMap((d, i) =>
    d.cerrado ? [] : [{ '@type': 'OpeningHoursSpecification', dayOfWeek: DIAS_SCHEMA[i], opens: d.abre, closes: d.cierra }]
  );
}

export { texto as textoDia };
