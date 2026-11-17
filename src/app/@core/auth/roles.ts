/**
 * Roles del backend: `client` compra entradas, `user` es el personal del local
 * (compra como un cliente y escanea en la app de la puerta) y `admin` lo
 * administra todo. Solo el admin entra al panel.
 */
export const ROLES_PANEL = ['admin'];

export const puedeVerPanel = (role?: string | null): boolean => !!role && ROLES_PANEL.includes(role);

/** Escáner de entradas de la puerta (/puerta): personal y admin. */
export const ROLES_PUERTA = ['admin', 'user'];

export const puedeEscanear = (role?: string | null): boolean => !!role && ROLES_PUERTA.includes(role);
