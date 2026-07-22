import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const roleGuard: CanActivateFn = async (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Esperar a que la sesión esté inicializada (crítico en recargas de página)
  const currentUser = await authService.waitForAuth();

  if (!currentUser) {
    return router.createUrlTree(['/login']);
  }

  // Los roles permitidos se definen en el data de cada ruta
  const allowedRoles = route.data['roles'] as Array<'admin' | 'vendedor' | 'despachador' | 'chofer'>;

  if (allowedRoles && !allowedRoles.includes(currentUser.rol)) {
    return router.createUrlTree(['/login']);
  }

  // Los despachadores van directo a logística si intentan entrar al dashboard
  if ((state.url === '/' || state.url === '/dashboard') && currentUser.rol === 'despachador') {
    return router.createUrlTree(['/logistica']);
  }

  return true;
};
