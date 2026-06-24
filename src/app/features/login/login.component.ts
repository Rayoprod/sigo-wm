import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { CardModule } from 'primeng/card';
import { AuthService } from '../../core/services/auth.service';
import { MessageModule } from 'primeng/message';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    PasswordModule,
    CardModule,
    MessageModule
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  authService = inject(AuthService);
  router = inject(Router);

  email = '';
  password = '';
  loading = false;
  errorMsg = '';

  async login() {
    if (!this.email || !this.password) {
      this.errorMsg = 'Por favor, ingresa tus credenciales.';
      return;
    }

    this.loading = true;
    this.errorMsg = '';
    
    try {
      await this.authService.signIn(this.email, this.password);
      const user = await this.authService.waitForAuth();
      
      if (user?.rol === 'chofer') {
        await this.authService.signOut();
        this.errorMsg = 'Acceso denegado. Los choferes deben usar la aplicación móvil, no la plataforma web.';
        return;
      }
      
      if (user?.rol === 'despachador') {
        // replaceUrl: true elimina /login del historial del navegador.
        // Sin esto, el botón "Atrás" desde el panel regresa a /login.
        this.router.navigate(['/logistica'], { replaceUrl: true });
      } else {
        this.router.navigate(['/'], { replaceUrl: true });
      }
    } catch (error: any) {
      this.errorMsg = error.message || 'Error al iniciar sesión. Verifica tus datos.';
    } finally {
      this.loading = false;
    }
  }
}
