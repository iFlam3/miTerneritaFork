import { Component, inject, OnInit, signal } from '@angular/core';
import { DIAS, diaDeHoy, HORARIO_PREDETERMINADO, horarioValido, textoDia } from '../../@core/utils/horario';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { SettingsService } from '../../@core/services/settings.service';
import { VENUE } from '../../@core/data/site';
import { RevealDirective } from '../../shared/directives/reveal.directive';

@Component({
  selector: 'app-contact',
  imports: [
    ReactiveFormsModule,
    RevealDirective
  ],
  templateUrl: './contact.component.html',
  styleUrl: './contact.component.scss'
})
export class ContactComponent implements OnInit {
  private fb = inject(FormBuilder);
  private settingsService = inject(SettingsService);
  private sanitizer = inject(DomSanitizer);

  readonly venue = VENUE;
  readonly mapUrl = this.sanitizer.bypassSecurityTrustResourceUrl(VENUE.mapsEmbed);

  instagram = signal('');
  tiktok = signal('');
  email = signal('info@miternerita.com');
  readonly dias = DIAS;
  readonly hoy = diaDeHoy();
  readonly textoDia = textoDia;
  horario = signal(HORARIO_PREDETERMINADO);

  private phone = "584146416366";
  readonly whatsappUrl = `https://wa.me/${this.phone}`;

  ngOnInit() {
    this.settingsService.getSettings().subscribe((data: any) => {
      this.instagram.set(data?.instagram ?? '');
      this.tiktok.set(data?.tiktok ?? '');
      if (data?.email) this.email.set(data.email);
      this.horario.set(horarioValido(data?.horario));
    });
  }

  whatsappForm = this.fb.nonNullable.group({
    nombre: ['', Validators.required],
    apellido: [''],
    mensaje: ['', Validators.required]
  });

  sendMessage() {
    if (this.whatsappForm.invalid) {
      this.whatsappForm.markAllAsTouched();
      return;
    }

    const { nombre, apellido, mensaje } = this.whatsappForm.getRawValue();
    const texto = `Nombre: ${nombre}\nApellido: ${apellido}\n\n${mensaje}`;
    window.open(`${this.whatsappUrl}?text=${encodeURIComponent(texto)}`, '_blank');
    this.whatsappForm.reset();
  }
}
