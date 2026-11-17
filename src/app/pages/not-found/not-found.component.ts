import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Ruta que no existe: antes se redirigía al inicio sin avisar. */
@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template: `
    <section class="tm-container not-found">
      <div class="tm-empty">
        <span class="tm-empty-icon"><i class="pi pi-compass"></i></span>
        <h1>Página no encontrada</h1>
        <p>El enlace no existe o cambió. Revisa la dirección o vuelve a la cartelera.</p>
        <a routerLink="/" class="tm-btn tm-btn--primary"><i class="pi pi-home"></i> Ir al inicio</a>
      </div>
    </section>
  `,
  styles: `
    .not-found {
      display: grid;
      place-items: center;
      min-height: 60vh;
      padding-block: 3rem;
    }

    h1 {
      margin: 0;
      font-size: clamp(1.4rem, 4vw, 2rem);
    }
  `
})
export class NotFoundComponent {}
