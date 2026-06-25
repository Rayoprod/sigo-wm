import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const roleGuard: CanActivateFn = async (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  
  // Wait for session initialization to complete (crucial for page reloads)
  const currentUser = await authService.waitForAuth();
  
  console.log(`[RoleGuard] Evaluando ruta: ${route.routeConfig?.path}`);
  console.log(`[RoleGuard] currentUser:`, currentUser);
  
  if (!currentUser) {
    console.warn('[RoleGuard] Acceso denegado: Usuario no autenticado');
    return router.createUrlTree(['/login']);
  }
  
  // The route data should define the allowed roles
  const allowedRoles = route.data['roles'] as Array<'admin' | 'vendedor' | 'despachador' | 'chofer'>;
  console.log(`[RoleGuard] Roles permitidos:`, allowedRoles, `Rol del usuario:`, currentUser.rol);
  
  if (allowedRoles && !allowedRoles.includes(currentUser.rol)) {
    console.warn(`[RoleGuard] Acceso denegado: El rol '${currentUser.rol}' no tiene permisos para esta ruta`);
    // Redirect to login if they are not allowed on the main layout
    return router.createUrlTree(['/login']);
  }

  // Despachadores get redirected to logistica if they hit the dashboard directly
  if ((state.url === '/' || state.url === '/dashboard') && currentUser.rol === 'despachador') {
    return router.createUrlTree(['/logistica']);
  }
  
  return true;
};
