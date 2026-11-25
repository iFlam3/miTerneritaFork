import { Component } from '@angular/core';
import { SPACES } from '../../../@core/data/site';
import { RevealDirective } from '../../directives/reveal.directive';

/** Galería tipo bento "Conoce nuestros espacios". Las fotos se editan en @core/data/site.ts */
@Component({
  selector: 'app-spaces-gallery',
  imports: [RevealDirective],
  templateUrl: './spaces-gallery.component.html',
  styleUrl: './spaces-gallery.component.scss'
})
export class SpacesGalleryComponent {
  readonly spaces = SPACES;

  /** Variantes de 480 y 800 px (mismo nombre con -480/-800): el móvil no baja la foto de 1600 px. */
  srcset(src: string) {
    const base = src.replace(/\.webp$/, '');
    return `${base}-480.webp 480w, ${base}-800.webp 800w, ${src} 1600w`;
  }
}
