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
import { AsArrayPipe } from '../../pipes/as-array.pipe';

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
    ChatBotComponent,
    AsArrayPipe
  ],
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.scss'
})
export class MainLayoutComponent {
  authService = inject(AuthService);
  themeService = inject(ThemeService);
  sidebarVisible = false;

  user = this.authService.currentUser;

  // Level A Security - UI Visibility based on roles
  menuItems = computed<MenuItem[]>(() => {
    const roles = this.user()?.rol || [];
    const rolesArr = Array.isArray(roles) ? roles : [roles];
    
    const isAdmin = rolesArr.includes('admin');
    const isVendedor = rolesArr.includes('vendedor');
    const isDespachador = rolesArr.includes('despachador');

    const items: MenuItem[] = [
      { label: 'Dashboard', icon: 'pi pi-home', routerLink: '/dashboard', visible: isAdmin || isVendedor }
    ];

    if (isAdmin || isVendedor) {
      items.push({ label: 'Ventas y Cotizaciones', icon: 'pi pi-shopping-cart', routerLink: '/comercial' });
      items.push({ label: 'Productos e Inventario', icon: 'pi pi-box', routerLink: '/catalogo' });
      items.push({ label: 'Clientes', icon: 'pi pi-users', routerLink: '/clientes' });
    }

    if (isAdmin || isDespachador || isVendedor) {
      items.push({ label: 'Logística y Despachos', icon: 'pi pi-truck', routerLink: '/logistica' });
    }

    if (isDespachador && !isAdmin && !isVendedor) {
      items.push({ label: 'Productos e Inventario', icon: 'pi pi-box', routerLink: '/catalogo' });
    }

    if (isAdmin) {
      items.push({ label: 'Reportes Analíticos', icon: 'pi pi-chart-bar', routerLink: '/reportes' });
      items.push({ label: 'Configuración', icon: 'pi pi-cog', routerLink: '/configuracion' });
    }

    return items;
  });

  get primaryRole(): string {
    const roles = this.user()?.rol || [];
    const rolesArr = Array.isArray(roles) ? roles : [roles];
    if (rolesArr.includes('admin')) return 'admin';
    if (rolesArr.includes('vendedor')) return 'vendedor';
    if (rolesArr.includes('despachador')) return 'despachador';
    if (rolesArr.includes('chofer')) return 'chofer';
    return rolesArr[0] || 'usuario';
  }

  async logout() {
    await this.authService.signOut();
  }
}
