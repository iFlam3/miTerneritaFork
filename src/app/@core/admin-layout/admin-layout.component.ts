import { DOCUMENT } from '@angular/common';
import { Component, computed, effect, HostListener, inject, OnInit, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { PageTitleStrategy } from '../services/page-title.strategy';
import { ThemeToggleComponent } from '../../shared/components/theme-toggle/theme-toggle.component';
import { AvatarComponent, avatarSeed } from '../../shared/components/avatar/avatar.component';

interface RouteLayout {
  name: string;
  icon: string;
  routerLink: string;
}

interface RouteGroup {
  label: string;
  items: RouteLayout[];
}

/** Antes solo se guardaba si estaba contraído; se lee para no perder la preferencia. */
const COLLAPSE_KEY = 'tm-admin-collapsed';
const ANCHO_KEY = 'tm-admin-side-w';
/** Solo iconos. */
const ANCHO_MIN = 84;
const ANCHO_MAX = 264;
/** Por debajo de este ancho se ven solo los iconos; al soltar se ajusta al mínimo. */
const ANCHO_ICONOS = 160;
const PASO_TECLADO = 16;

@Component({
  selector: 'app-admin-layout',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ThemeToggleComponent,
    AvatarComponent
  ],
  templateUrl: './admin-layout.component.html',
  styleUrl: './admin-layout.component.scss'
})
export class AdminLayoutComponent implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);
  private document = inject(DOCUMENT);
  readonly pageTitle = inject(PageTitleStrategy).current;

  nombre = '';
  lastName = '';
  role = '';
  readonly year = new Date().getFullYear();

  mobileOpen = signal(false);
  readonly anchoMin = ANCHO_MIN;
  readonly anchoMax = ANCHO_MAX;
  /** Ancho de la barra lateral en escritorio; se arrastra desde su borde derecho. */
  ancho = signal(this.leerAncho());
  collapsed = computed(() => this.ancho() <= ANCHO_ICONOS);
  redimensionando = signal(false);
  /** Último ancho con texto: el botón de menú vuelve a él al expandir. */
  private anchoAbierto = this.ancho() > ANCHO_ICONOS ? this.ancho() : ANCHO_MAX;
  seed = '?';

  readonly groups: RouteGroup[] = [
    {
      label: 'General',
      items: [
        { name: 'Dashboard', icon: 'pi pi-chart-bar', routerLink: '/admin/dashboard' },
        { name: 'Escanear entradas', icon: 'pi pi-qrcode', routerLink: '/puerta' }
      ]
    },
    {
      label: 'Ventas',
      items: [
        { name: 'Eventos', icon: 'pi pi-calendar', routerLink: '/admin/events' },
        { name: 'Entradas', icon: 'pi pi-ticket', routerLink: '/admin/tickets' },
        { name: 'Mapa de mesas', icon: 'pi pi-map', routerLink: '/admin/salon' },
        { name: 'Pagos', icon: 'pi pi-wallet', routerLink: '/admin/payments' },
        { name: 'Historial de entradas', icon: 'pi pi-history', routerLink: '/admin/escaneos' },
        { name: 'Reportes', icon: 'pi pi-file-pdf', routerLink: '/admin/reportes' },
        { name: 'Bebidas', icon: 'pi ico ico-copa', routerLink: '/admin/drinks' },
        { name: 'Comidas', icon: 'pi ico ico-cubiertos', routerLink: '/admin/foods' }
      ]
    },
    {
      label: 'Personas',
      items: [
        { name: 'Usuarios', icon: 'pi pi-user', routerLink: '/admin/users' },
        { name: 'Clientes', icon: 'pi pi-users', routerLink: '/admin/clients' },
        { name: 'Postulaciones', icon: 'pi pi-briefcase', routerLink: '/admin/postulaciones' }
      ]
    }
  ];

  constructor() {
    effect(() => {
      try {
        localStorage.setItem(ANCHO_KEY, String(this.ancho()));
      } catch {}
    });
    effect(() => this.document.body.classList.toggle('tm-no-scroll', this.mobileOpen()));
  }

  ngOnInit() {
    const user = localStorage.getItem('user');
    if (user) {
      const userObj = JSON.parse(user);
      this.nombre = userObj.name ?? '';
      this.lastName = userObj.lastName ?? '';
      this.role = userObj.role ?? '';
      this.seed = avatarSeed(userObj);
    }

    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => this.mobileOpen.set(false));
  }

  @HostListener('document:keydown.escape')
  closeMobile() {
    this.mobileOpen.set(false);
  }

  toggleSidebar() {
    if (this.document.defaultView && this.document.defaultView.innerWidth < 1024) {
      this.mobileOpen.set(!this.mobileOpen());
    } else {
      this.fijarAncho(this.collapsed() ? this.anchoAbierto : ANCHO_MIN);
    }
  }

  empezarResize(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.redimensionando.set(true);
  }

  /** La barra empieza en x = 0: la posición del puntero es el ancho. */
  moverResize(e: PointerEvent) {
    if (this.redimensionando()) this.ancho.set(this.limitar(e.clientX));
  }

  soltarResize() {
    if (!this.redimensionando()) return;
    this.redimensionando.set(false);
    this.fijarAncho(this.ancho());
  }

  teclaResize(e: KeyboardEvent) {
    const destino: Record<string, number> = {
      ArrowLeft: this.ancho() - PASO_TECLADO,
      ArrowRight: this.ancho() + PASO_TECLADO,
      Home: ANCHO_MIN,
      End: ANCHO_MAX
    };
    if (!(e.key in destino)) return;
    e.preventDefault();
    this.fijarAncho(destino[e.key]);
  }

  /** Entre el mínimo y el umbral de iconos no hay término medio: se queda en solo iconos. */
  private fijarAncho(px: number) {
    const ancho = this.limitar(px);
    this.ancho.set(ancho <= ANCHO_ICONOS ? ANCHO_MIN : ancho);
    if (ancho > ANCHO_ICONOS) this.anchoAbierto = ancho;
  }

  private limitar(px: number) {
    return Math.round(Math.min(ANCHO_MAX, Math.max(ANCHO_MIN, px)));
  }

  logOut() {
    this.authService.logout()
    this.router.navigateByUrl("/login");
  }

  private leerAncho() {
    try {
      const guardado = Number(localStorage.getItem(ANCHO_KEY));
      if (guardado) return this.limitar(guardado);
      return localStorage.getItem(COLLAPSE_KEY) === '1' ? ANCHO_MIN : ANCHO_MAX;
    } catch {
      return ANCHO_MAX;
    }
  }
}
