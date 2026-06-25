import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Guard para la ruta /login.
 * Si el usuario ya tiene sesión activa, lo redirige al panel principal
 * en lugar de mostrarle el formulario de login.
 */
export const authGuard: CanActivateFn = async (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const currentUser = await authService.waitForAuth();

  if (currentUser) {
    // Ya autenticado: redirigir al panel según su rol
    if (currentUser.rol === 'despachador') {
      return router.createUrlTree(['/logistica']);
    }
    return router.createUrlTree(['/']);
  }

  // No autenticado: permitir acceso al login
  return true;
};
