/**
 * FUENTE ÚNICA DE VERDAD para los roles de la aplicación.
 *
 * Reglas del sistema:
 * - Un usuario puede tener MÚLTIPLES roles simultáneos (array).
 * - `admin` es un supertipo: implica acceso total en web y mobile.
 * - `vendedor` solo opera en web (sin interfaz mobile).
 * - `chofer` solo opera en mobile (bloqueado en web).
 * - `despachador` opera en ambas plataformas.
 *
 * Para agregar un rol nuevo: añadirlo aquí. TypeScript propagará
 * los errores de compilación a todos los lugares que deban actualizarse.
 */

export const APP_ROLES = {
  ADMIN:       'admin',
  VENDEDOR:    'vendedor',
  DESPACHADOR: 'despachador',
  CHOFER:      'chofer',
} as const;

/** Tipo derivado automáticamente del objeto — nunca desincronizado. */
export type AppRole = typeof APP_ROLES[keyof typeof APP_ROLES];

/**
 * Roles que tienen interfaz en la aplicación web.
 * Los choferes deben usar la app móvil.
 */
export const WEB_ROLES: AppRole[] = [
  APP_ROLES.ADMIN,
  APP_ROLES.VENDEDOR,
  APP_ROLES.DESPACHADOR,
];

/**
 * Roles que tienen interfaz en la aplicación móvil.
 * Los vendedores y admins sin roles mobile usan solo la web.
 * (admin implica acceso a todos los roles mobile igualmente)
 */
export const MOBILE_ROLES: AppRole[] = [
  APP_ROLES.DESPACHADOR,
  APP_ROLES.CHOFER,
];
