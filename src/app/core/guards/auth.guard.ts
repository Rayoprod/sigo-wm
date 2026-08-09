import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Guard para la ruta /login.
 * Si el usuario ya tiene sesi\u00f3n activa, lo redirige al panel correcto
 * seg\u00fan sus roles, en lugar de mostrarle el formulario de login.
 */
export const authGuard: CanActivateFn = async () => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  const currentUser = await auth.waitForAuth();
  if (!currentUser) return true; // No autenticado → mostrar login

  // Ya autenticado: redirigir según roles
  // Despachador puro (sin admin ni vendedor) → logística directamente
  if (auth.hasRole('despachador') && !auth.hasRole('vendedor')) {
    return router.createUrlTree(['/logistica']);
  }

  return router.createUrlTree(['/']);
};
