import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { Conciliacion, PaymentService } from '../../../../@core/services/payment.service';
import { DropFilesDirective } from '../../../../shared/directives/drop-files.directive';

/**
 * Conciliación bancaria: se sube el estado de cuenta y se proponen los pagos
 * pendientes cuya referencia (y monto) aparece en el banco. El admin confirma
 * cuáles aprobar; los que coinciden en referencia y monto vienen marcados.
 */
@Component({
  selector: 'app-conciliar',
  imports: [ButtonModule, DropFilesDirective, CurrencyPipe, DecimalPipe],
  templateUrl: './conciliar.component.html',
  styleUrl: './conciliar.component.scss'
})
export class ConciliarComponent {
  private payments = inject(PaymentService);
  private messages = inject(MessageService);
  private ref = inject(DynamicDialogRef, { optional: true });

  readonly cargando = signal(false);
  readonly aprobando = signal(false);
  readonly archivo = signal<string>('');
  readonly datos = signal<Conciliacion | null>(null);
  readonly marcados = signal<Set<number>>(new Set());
  readonly totalMarcados = computed(() => this.marcados().size);

  elegir(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.archivo.set(file.name);
    this.datos.set(null);
    this.cargando.set(true);
    this.payments.conciliar(file).subscribe({
      next: d => {
        this.datos.set(d);
        this.marcados.set(new Set(d.resultados.filter(r => r.resultado === 'coincide').map(r => r.idPayment)));
        this.cargando.set(false);
      },
      error: err => {
        this.cargando.set(false);
        this.messages.add({ severity: 'error', summary: 'No se pudo leer el estado de cuenta', detail: err?.error?.message });
      }
    });
  }

  alternar(id: number) {
    this.marcados.update(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  aprobar() {
    const ids = [...this.marcados()];
    if (!ids.length) return;
    this.aprobando.set(true);
    this.payments.aprobarLote(ids).subscribe({
      next: r => {
        this.aprobando.set(false);
        if (r.aprobados.length) {
          this.messages.add({ severity: 'success', summary: `${r.aprobados.length} ${r.aprobados.length === 1 ? 'pago aprobado' : 'pagos aprobados'}`, detail: 'Se enviaron las entradas por correo' });
        }
        for (const e of r.errores) {
          this.messages.add({ severity: 'warn', summary: `Pago ${e.idPayment} no aprobado`, detail: e.mensaje });
        }
        // Se quitan de la lista los ya aprobados.
        const hechos = new Set(r.aprobados);
        this.datos.update(d => d && { ...d, resultados: d.resultados.filter(x => !hechos.has(x.idPayment)) });
        this.marcados.update(s => new Set([...s].filter(id => !hechos.has(id))));
        if (!this.datos()?.resultados.length) this.ref?.close();
      },
      error: err => {
        this.aprobando.set(false);
        this.messages.add({ severity: 'error', summary: 'No se aprobaron', detail: err?.error?.message });
      }
    });
  }

  cerrar() {
    this.ref?.close();
  }
}
