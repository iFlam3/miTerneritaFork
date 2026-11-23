import { LoaderComponent } from '../../@core/components/loader/loader.component';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { DIAS, DiaHorario, horarioValido } from '../../@core/utils/horario';
import { MessageService } from 'primeng/api';
import { InputText } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SettingsService } from '../../@core/services/settings.service';
import { BANKS } from '../../pages/payment/payment.component';

type Seccion = 'general' | 'pagos' | 'horario';

/** Configuración del sitio: datos generales y cuentas que reciben los pagos. */
@Component({
  selector: 'app-settings',
  imports: [ReactiveFormsModule, InputText, SelectModule, ToggleSwitch, LoaderComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent implements OnInit {
  private settingsService = inject(SettingsService);
  private messageService = inject(MessageService);
  private fb = inject(FormBuilder).nonNullable;

  readonly bancos = BANKS.map(b => b.label);
  guardando = signal<Seccion | null>(null);

  general = this.fb.group({
    email: ['', Validators.email],
    phone: [''],
    instagram: [''],
    BCV: [null as number | null, Validators.min(0)]
  });

  pagos = this.fb.group({
    pmBanco: [''],
    pmCedula: [''],
    pmTelefono: [''],
    trBanco: [''],
    trCuenta: [''],
    trRif: [''],
    zelleTitular: [''],
    zelleTelefono: [''],
    zelleCorreo: ['', Validators.email]
  });

  readonly dias = DIAS;
  /** Horario del local, de lunes a domingo (solo informativo: la web vende siempre). */
  horario = this.fb.array(
    DIAS.map(() =>
      this.fb.group({
        abierto: [true],
        abre: ['12:00', Validators.required],
        cierra: ['23:00', Validators.required]
      })
    )
  );

  cargando = signal(true);

  ngOnInit() {
    this.settingsService.getSettings().subscribe({
      next: settings => {
        this.general.patchValue(settings as never);
        this.pagos.patchValue(settings as never);
        this.horario.patchValue(
          horarioValido((settings as { horario?: unknown }).horario).map(d => ({ abierto: !d.cerrado, abre: d.abre, cierra: d.cierra }))
        );
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false)
    });
  }

  invalido(form: FormGroup, campo: string): boolean {
    const c = form.get(campo);
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  guardar(seccion: Seccion) {
    const form = seccion === 'general' ? this.general : seccion === 'pagos' ? this.pagos : this.horario;
    if (form.invalid) {
      form.markAllAsTouched();
      return;
    }
    // Vacío = sin dato (null), así un correo borrado no falla la validación.
    const datos =
      seccion === 'horario'
        ? { horario: this.horario.getRawValue().map((d): DiaHorario => ({ cerrado: !d.abierto, abre: d.abre, cierra: d.cierra })) }
        : Object.fromEntries(
            Object.entries((form as FormGroup).getRawValue()).map(([k, v]) => [k, v === '' || v === null ? null : k === 'BCV' ? Number(v) : String(v).trim()])
          );
    this.guardando.set(seccion);
    this.settingsService.updateSettings(datos).subscribe({
      next: () => {
        this.guardando.set(null);
        form.markAsPristine();
        const resumen = { general: 'Configuración guardada', pagos: 'Datos de pago guardados', horario: 'Horario guardado' };
        this.messageService.add({ severity: 'success', summary: resumen[seccion] });
      },
      error: err => {
        this.guardando.set(null);
        const detalle = err?.error?.message;
        this.messageService.add({ severity: 'error', summary: 'No se pudo guardar', detail: Array.isArray(detalle) ? detalle.join(', ') : detalle });
      }
    });
  }
}
