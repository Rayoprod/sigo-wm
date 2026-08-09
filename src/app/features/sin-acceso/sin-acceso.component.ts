import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-sin-acceso',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  template: `
    <div class="min-h-screen flex flex-column align-items-center justify-content-center gap-4"
         style="background: var(--surface-ground);">

      <div class="flex flex-column align-items-center gap-3 text-center" style="max-width: 420px; padding: 2rem;">

        <!-- Icono -->
        <div class="flex align-items-center justify-content-center border-circle"
             style="width: 80px; height: 80px; background: var(--red-100);">
          <i class="pi pi-lock" style="font-size: 2.2rem; color: var(--red-500);"></i>
        </div>

        <!-- Título -->
        <h1 class="text-900 font-bold m-0" style="font-size: 1.6rem;">
          Sin acceso
        </h1>

        <!-- Descripción -->
        <p class="text-500 m-0 line-height-3">
          No tienes permiso para ver esta sección.
          Si crees que esto es un error, contacta con el administrador del sistema.
        </p>

        <!-- Acciones -->
        <div class="flex gap-2 mt-2">
          <button pButton
                  label="Volver"
                  icon="pi pi-arrow-left"
                  class="p-button-outlined"
                  (click)="volver()">
          </button>
          <button pButton
                  label="Ir al inicio"
                  icon="pi pi-home"
                  (click)="irAlInicio()">
          </button>
        </div>

        <!-- Usuario actual (debug/info) -->
        <p class="text-400 text-xs m-0" *ngIf="auth.currentUser() as user">
          Conectado como <strong>{{ user.nombre_completo || user.correo }}</strong>
          · Roles: {{ user.rol | json }}
        </p>

      </div>
    </div>
  `
})
export class SinAccesoComponent {
  auth = inject(AuthService);
  private router = inject(Router);

  volver() {
    window.history.back();
  }

  irAlInicio() {
    this.router.navigate(['/']);
  }
}
