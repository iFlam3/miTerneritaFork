import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment.developer';
import { EstadoSalon, PlanoSalon } from '../models/salon.model';

/** Mapa del salón: plano fijo, zonas por mesa y puestos tomados de cada evento. */
@Injectable({ providedIn: 'root' })
export class SalonService {
  private http = inject(HttpClient);
  private api = `${environment.api}/salon`;

  /** El plano no cambia: se pide una vez por sesión. */
  readonly plano$ = this.http.get<PlanoSalon>(`${this.api}/plano`).pipe(shareReplay(1));

  estado(idEvents: number) {
    return this.http.get<EstadoSalon>(`${this.api}/${idEvents}`);
  }

  guardarZonas(idEvents: number, zonas: { mesa: number; idTicket: number }[]) {
    return this.http.put<EstadoSalon>(`${this.api}/${idEvents}/zonas`, { zonas });
  }
}
