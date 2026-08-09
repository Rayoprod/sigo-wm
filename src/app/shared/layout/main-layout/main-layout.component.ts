import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToolbarModule } from 'primeng/toolbar';
import { ButtonModule } from 'primeng/button';
import { SidebarModule } from 'primeng/sidebar';
import { AvatarModule } from 'primeng/avatar';
import { MenuModule } from 'primeng/menu';
import { MenuItem } from 'primeng/api';
import { TooltipModule } from 'primeng/tooltip';
import { ChatBotComponent } from '../chat-bot/chat-bot.component';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ToolbarModule,
    ButtonModule,
    SidebarModule,
    AvatarModule,
    MenuModule,
    TooltipModule,
    ChatBotComponent
  ],
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.scss'
})
export class MainLayoutComponent {
  authService = inject(AuthService);
  themeService = inject(ThemeService);
  sidebarVisible = false;

  user = this.authService.currentUser;

  /** ¿Puede ver el chatbot? Admin y vendedor tienen acceso. */
  readonly puedeVerChatbot = computed(() =>
    this.authService.hasRole('admin', 'vendedor')
  );

  /**
   * Items de menú calculados según los roles del usuario.
   * Usa authService.isAdmin() y authService.userRoles() directamente
   * para no acoplar la UI a strings de roles.
   */
  menuItems = computed<MenuItem[]>(() => {
    const isAdmin       = this.authService.isAdmin();
    const rawRoles      = this.authService.userRoles();
    const isVendedor    = rawRoles.includes('vendedor');
    const isDespachador = rawRoles.includes('despachador');

    const items: MenuItem[] = [];

    if (isAdmin || isVendedor) {
      items.push(
        { label: 'Dashboard',             icon: 'pi pi-home',          routerLink: '/dashboard' },
        { label: 'Ventas y Cotizaciones', icon: 'pi pi-shopping-cart', routerLink: '/comercial' },
        { label: 'Productos e Inventario',icon: 'pi pi-box',           routerLink: '/catalogo'  },
        { label: 'Clientes',              icon: 'pi pi-users',         routerLink: '/clientes'  },
      );
    }

    if (isAdmin || isVendedor || isDespachador) {
      items.push({ label: 'Logística y Despachos', icon: 'pi pi-truck', routerLink: '/logistica' });
    }

    // Despachador puro (sin vendedor ni admin) también ve Catálogo
    if (isDespachador && !isAdmin && !isVendedor) {
      items.push({ label: 'Productos e Inventario', icon: 'pi pi-box', routerLink: '/catalogo' });
    }

    if (isAdmin) {
      items.push(
        { label: 'Reportes Analíticos', icon: 'pi pi-chart-bar', routerLink: '/reportes'      },
        { label: 'Configuración',       icon: 'pi pi-cog',       routerLink: '/configuracion' },
      );
    }

    return items;
  });

  /** Rol principal para mostrar en el topbar (el de mayor jerarquía). */
  get primaryRole(): string {
    if (this.authService.isAdmin())                         return 'admin';
    const roles = this.authService.userRoles();
    if (roles.includes('vendedor'))    return 'vendedor';
    if (roles.includes('despachador')) return 'despachador';
    if (roles.includes('chofer'))      return 'chofer';
    return roles[0] || 'usuario';
  }

  async logout() {
    await this.authService.signOut();
  }
}
