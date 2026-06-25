import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ToolbarModule } from 'primeng/toolbar';
import { ButtonModule } from 'primeng/button';
import { SidebarModule } from 'primeng/sidebar';
import { AvatarModule } from 'primeng/avatar';
import { MenuModule } from 'primeng/menu';
import { MenuItem } from 'primeng/api';
import { ChatBotComponent } from '../../components/chat-bot/chat-bot.component';

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
    ChatBotComponent
  ],
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.scss'
})
export class MainLayoutComponent {
  authService = inject(AuthService);
  sidebarVisible = false;

  user = this.authService.currentUser;

  // Level A Security - UI Visibility based on roles
  menuItems = computed<MenuItem[]>(() => {
    const rol = this.user()?.rol;
    const items: MenuItem[] = [
      { label: 'Dashboard', icon: 'pi pi-home', routerLink: '/dashboard', visible: rol === 'admin' || rol === 'vendedor' }
    ];

    if (rol === 'admin' || rol === 'vendedor') {
      items.push({ label: 'Ventas y Cotizaciones', icon: 'pi pi-shopping-cart', routerLink: '/comercial' });
      items.push({ label: 'Catálogo de Productos', icon: 'pi pi-box', routerLink: '/catalogo' });
      items.push({ label: 'Control de Inventario', icon: 'pi pi-warehouse', routerLink: '/inventario' });
      items.push({ label: 'Clientes', icon: 'pi pi-users', routerLink: '/clientes' });
    }

    if (rol === 'admin' || rol === 'despachador') {
      items.push({ label: 'Logística y Despachos', icon: 'pi pi-truck', routerLink: '/logistica' });
    }

    if (rol === 'admin') {
      items.push({ label: 'Reportes Analíticos', icon: 'pi pi-chart-bar', routerLink: '/reportes' });
      items.push({ label: 'Configuración', icon: 'pi pi-cog', routerLink: '/configuracion' });
    }

    return items;
  });

  async logout() {
    await this.authService.signOut();
  }
}
