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

  // Extraemos los roles del usuario de manera segura
  let userRoles: string[] = [];
  if (Array.isArray(currentUser.rol)) {
    userRoles = currentUser.rol;
  } else if (typeof currentUser.rol === 'string') {
    userRoles = [currentUser.rol];
  }

  // El Administrador tiene acceso irrestricto en la app web
  if (userRoles.includes('admin')) {
    return true;
  }

  // Verifica si hay intersección (el usuario tiene al menos uno de los roles permitidos)
  if (allowedRoles && !allowedRoles.some(r => userRoles.includes(r))) {
    return router.createUrlTree(['/login']);
  }

  // Si intenta ir al dashboard y SOLO es despachador, mandarlo a logistica
  // (Si es admin y despachador a la vez, sí puede ver el dashboard)
  if ((state.url === '/' || state.url === '/dashboard') && userRoles.includes('despachador') && !userRoles.includes('admin') && !userRoles.includes('vendedor')) {
    return router.createUrlTree(['/logistica']);
  }

  return true;
};
