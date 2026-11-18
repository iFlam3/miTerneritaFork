import { HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, filter, switchMap, throwError } from 'rxjs';
import { DialogService } from 'primeng/dynamicdialog';
import { ConfirmDeleteModalComponent } from './components/confirm-delete-modal/confirm-delete-modal.component';

/**
 * Borra y, si el back responde 409 con requiereConfirmacion (el registro tiene
 * ventas o facturas), muestra su aviso y repite con confirmar=true.
 * Si el admin cancela, el observable termina sin emitir.
 */
export function borrarConAviso<T>(
  dialog: DialogService,
  borrar: (confirmar: boolean) => Observable<T>,
): Observable<T> {
  return borrar(false).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 409 || !err.error?.requiereConfirmacion) return throwError(() => err);
      const ref = dialog.open(ConfirmDeleteModalComponent, {
        header: 'Tiene datos asociados',
        width: '40vw',
        modal: true,
        breakpoints: { '960px': '94vw' },
        data: { message: err.error.message },
      });
      return ref.onClose.pipe(
        filter((ok: boolean) => !!ok),
        switchMap(() => borrar(true)),
      );
    }),
  );
}
