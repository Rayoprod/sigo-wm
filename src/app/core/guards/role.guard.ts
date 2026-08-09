import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { AppRole } from '../auth/roles';

/**
 * Guard de roles para rutas protegidas.
 *
 * Uso en routes:
 *   canActivate: [roleGuard],
 *   data: { roles: ['admin', 'vendedor'] }
 *
 * - Si no hay sesi\u00f3n        → redirige a /login
 * - Si es admin             → acceso total (sin revisar roles requeridos)
 * - Si tiene al menos un rol requerido → acceso permitido
 * - Si no tiene ning\u00fan rol requerido → redirige a /sin-acceso
 */
export const roleGuard: CanActivateFn = async (route, state) => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  await auth.waitForAuth();

  // Sin sesión → login
  if (!auth.currentUser()) {
    return router.createUrlTree(['/login']);
  }

  // Admin tiene paso libre en toda la web
  if (auth.isAdmin()) {
    // Excepción: si solo intenta ir al dashboard y también es despachador
    // puro (sin admin/vendedor), lo mandamos a logística.
    // Pero si ES admin, puede ir al dashboard sin restricción.
    return true;
  }

  // Verificar roles requeridos por la ruta
  const requiredRoles = route.data?.['roles'] as AppRole[] | undefined;
  if (requiredRoles?.length && !auth.hasRole(...requiredRoles)) {
    return router.createUrlTree(['/sin-acceso']);
  }

  // Despachador puro intentando ir al dashboard → logística
  if (
    (state.url === '/' || state.url === '/dashboard') &&
    auth.hasRole('despachador') &&
    !auth.hasRole('vendedor')
  ) {
    return router.createUrlTree(['/logistica']);
  }

  return true;
};
