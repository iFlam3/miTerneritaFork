import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { EntradaPublica, PaymentService } from '../../@core/services/payment.service';
import { formatTime12, parseEventDate } from '../../@core/utils/event-utils';

/**
 * /entrada/<firma>: la entrada compartida por el personal (WhatsApp, impresa) a
 * clientes que no usan la web. Sin sesión: el enlace firmado es la llave.
 */
@Component({
  selector: 'app-entrada',
  imports: [DatePipe],
  templateUrl: './entrada.component.html',
  styleUrl: './entrada.component.scss'
})
export class EntradaComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private payments = inject(PaymentService);

  readonly entrada = signal<EntradaPublica | null>(null);
  readonly error = signal(false);
  readonly dia = computed(() => parseEventDate(this.entrada()?.evento.fecha));
  readonly hora = computed(() => formatTime12(this.entrada()?.evento.hora));

  ngOnInit() {
    const firma = this.route.snapshot.paramMap.get('firma') ?? '';
    this.payments.entradaPublica(firma).subscribe({
      next: e => this.entrada.set(e),
      error: () => this.error.set(true)
    });
  }

  imprimir() {
    window.print();
  }
}
