import { inject, Injectable } from '@angular/core';
import { environment } from '../../../environments/environment.developer';
import { HttpClient } from '@angular/common/http';
import { catchError, map, Observable, of, Subject, tap } from 'rxjs';

/** GET /payment/reporte/:idEvents: ventas cobradas del evento. */
export interface ReporteEvento {
  evento: { idEvents: number; nombre: string; fecha: string; hora: string; salon: string | null; categoria: string; capacidad: number; vendidas: number };
  entradas: { nombre: string; cantidad: number; total: number }[];
  consumo: { nombre: string; tipo: string; botella: boolean; cantidad: number; total: number }[];
  pagos: { estado: string; cantidad: number; total: number }[];
  totales: { entradas: number; consumo: number; general: number };
}

/** GET /entrada/:firma: lo que ve quien recibe el enlace de su entrada. */
export interface EntradaPublica {
  noDocumento: string;
  cliente: string;
  evento: { nombre: string; fecha: string; hora: string; salon: string | null };
  entradas: { nombre: string; cantidad: number }[];
  asientos: string[];
  /** PNG del QR como data URL. */
  qr: string;
}

/** POST /payment/conciliar */
export interface Conciliacion {
  filas: number;
  pendientes: number;
  resultados: {
    idPayment: number; resultado: 'coincide' | 'monto_distinto'; fila: number; texto: string;
    noDocumento: string; cliente: string; cedula: string | null; evento: string | null;
    banco: string; referencia: string; totalUsd: number; totalBs: number | null;
  }[];
}

@Injectable({
  providedIn: 'root'
})
export class PaymentService {
  private api: string = environment.api;
  private http = inject(HttpClient);
  private refreshPayments$ = new Subject<void>();
  public refreshPaymentsObservable$ = this.refreshPayments$.asObservable();

  /** Cruza el estado de cuenta (xlsx/csv) con los pagos pendientes. No cambia nada. */
  conciliar(archivo: File) {
    const fd = new FormData();
    fd.append('archivo', archivo);
    return this.http.post<Conciliacion>(`${this.api}/payment/conciliar`, fd);
  }

  /** Firma del enlace público de la entrada (/entrada/<firma>) de un pago aprobado. */
  enlaceEntrada(id: number) {
    return this.http.get<{ firma: string }>(`${this.api}/payment/${id}/enlace-entrada`);
  }

  /** La entrada pública (sin sesión) a partir de su firma. */
  entradaPublica(firma: string) {
    return this.http.get<EntradaPublica>(`${this.api}/entrada/${encodeURIComponent(firma)}`);
  }

  /** Aprueba varios pagos: cada uno emite su QR y su correo. */
  aprobarLote(ids: number[]) {
    return this.http.post<{ aprobados: number[]; errores: { idPayment: number; mensaje: string }[] }>(
      `${this.api}/payment/aprobar-lote`, { ids }
    ).pipe(tap(() => this.refreshPayments$.next()));
  }

  /** Excel de pagos para el contador, con los filtros dados. */
  exportar(filtros: { desde?: string; hasta?: string; idEvents?: number | null; status?: string }) {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(filtros)) if (v) params[k] = String(v);
    return this.http.get(`${this.api}/payment/exportar`, { params, responseType: 'blob' });
  }

  getReporte(idEvents: number) {
    return this.http.get<ReporteEvento>(`${this.api}/payment/reporte/${idEvents}`);
  }

   getAllPayments(){
    return this.http.get<any[]>(`${this.api}/payment`).pipe(
      map((res: any[] = []) => {
        const items = res ?? [];
        const sorted = items.slice().sort((a: any, b: any) => (b.idPayment ?? 0) - (a.idPayment ?? 0));
        return sorted.map((payment: any) => ({ ...payment }));
      }),
      catchError((error) => {
        console.error('Error al obtener los pagos:', error);
        return of([]);
      })
    );
  }

  createPayment(data: any){
    return this.http.post(`${this.api}/payment`, data ).pipe(
      tap(() => this.refreshPayments$.next())
    );
  }

  refresh(){
    this.refreshPayments$.next();
  }

  deletePayment(id: number){
    return this.http.delete(`${this.api}/payment/${id}`);
  }

  updatePayment(id: number, body: any){
    return this.http.patch(`${this.api}/payment/${id}/status`, body).pipe(
      tap(() => this.refreshPayments$.next())
    )
  }

  getComprobante(id: number){
    return this.http.get(`${this.api}/payment/${id}/comprobante`, {
      responseType: 'blob'
    } );
  }

  getTasaDolarEuro() {
  return this.http.get<any[]>(`${environment.apiDolar}`).pipe(
    map((res: any[]) => {
      const tasaDolar = res?.[0]?.promedio ?? 0;
      return tasaDolar;
    }),
    catchError((error) => {
      console.error('Error al obtener la tasa de cambio:', error);
      return of(0);
    })
  );
}
}
