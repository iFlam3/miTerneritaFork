import { Directive, ElementRef, inject, input, signal } from '@angular/core';

/**
 * Convierte el elemento en zona para soltar archivos: los pasa al <input type="file">
 * indicado y dispara su (change), así el componente los recibe igual que al elegirlos.
 * Uso: <button [appDropFiles]="fotoInput">…</button>
 */
@Directive({
  selector: '[appDropFiles]',
  host: {
    '(dragover)': 'encima($event)',
    '(dragleave)': 'salir($event)',
    '(drop)': 'soltar($event)',
    '(document:dragover)': 'fuera($event)',
    '(document:drop)': 'fuera($event)',
    '[class.drop-encima]': 'activo()'
  }
})
export class DropFilesDirective {
  private el = inject(ElementRef<HTMLElement>);
  appDropFiles = input.required<HTMLInputElement>();
  activo = signal(false);

  encima(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    this.activo.set(true);
  }

  salir(e: DragEvent) {
    if (!this.el.nativeElement.contains(e.relatedTarget as Node)) this.activo.set(false);
  }

  soltar(e: DragEvent) {
    e.preventDefault();
    this.activo.set(false);
    const input = this.appDropFiles();
    const archivos = [...(e.dataTransfer?.files ?? [])].filter(f => aceptado(f, input.accept));
    if (!archivos.length) return;
    const dt = new DataTransfer();
    (input.multiple ? archivos : archivos.slice(0, 1)).forEach(f => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Un archivo soltado fuera de la zona no debe abrirse en la pestaña y perder el formulario. */
  fuera(e: DragEvent) {
    if (e.defaultPrevented || !e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'none';
  }
}

/** Misma regla que el atributo accept: "image/*", "application/pdf" o ".pdf". */
function aceptado(f: File, accept: string): boolean {
  if (!accept) return true;
  return accept.split(',').some(regla => {
    const r = regla.trim().toLowerCase();
    if (r.startsWith('.')) return f.name.toLowerCase().endsWith(r);
    if (r.endsWith('/*')) return f.type.startsWith(r.slice(0, -1));
    return f.type === r;
  });
}
