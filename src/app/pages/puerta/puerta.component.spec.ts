import { Event } from '../../@core/models/event.model';
import { eventosDePuerta } from './puerta.component';

describe('eventosDePuerta', () => {
  const ev = (idEvents: number, date: string, status = 1, time = '21:00:00') => ({ idEvents, date, status, time }) as Event;
  const eventos = [ev(4, '2026-11-19'), ev(3, '2026-11-18'), ev(2, '2026-11-17'), ev(1, '2026-11-16'), ev(5, '2026-11-17', 0), ev(6, '2026-11-17', 1, '18:00:00')];
  const ids = (ahora: Date) => eventosDePuerta(eventos, ahora).map(e => e.idEvents);

  it('de día muestra los activos de hoy y mañana, por fecha y hora', () => {
    expect(ids(new Date(2026, 10, 17, 15))).toEqual([6, 2, 3]);
  });

  it('de madrugada sigue mostrando el evento de anoche', () => {
    expect(ids(new Date(2026, 10, 17, 2))).toEqual([1, 6, 2]);
  });

  it('a partir de las 6:00 cambia la jornada', () => {
    expect(ids(new Date(2026, 10, 17, 6))).toEqual([6, 2, 3]);
  });
});
