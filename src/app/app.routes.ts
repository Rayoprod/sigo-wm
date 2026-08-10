import { Routes } from '@angular/router';
import { LoginComponent } from './features/login/login.component';
import { MainLayoutComponent } from './shared/layout/main-layout/main-layout.component';
import { roleGuard } from './core/guards/role.guard';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent, canActivate: [authGuard] },
  {
    path: 'rastreo-cliente/:token',
    loadComponent: () => import('./features/rastreo-cliente/rastreo-cliente.component').then(m => m.RastreoClienteComponent)
  },
  {
    path: '',
    component: MainLayoutComponent,
    canActivate: [roleGuard],
    data: { roles: ['admin', 'vendedor', 'despachador'] },
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent)
      },
      {
        path: 'comercial',
        canActivate: [roleGuard],
        data: { roles: ['admin', 'vendedor'] },
        children: [
          {
            path: '',
            loadComponent: () => import('./features/comercial/comercial-list/comercial-list.component').then(m => m.ComercialListComponent)
          },
          {
            path: 'nuevo',
            loadComponent: () => import('./features/comercial/comercial-form/comercial-form.component').then(m => m.ComercialFormComponent)
          },
          {
            path: 'editar/:id',
            loadComponent: () => import('./features/comercial/comercial-form/comercial-form.component').then(m => m.ComercialFormComponent)
          }
        ]
      },
      {
        path: 'logistica',
        canActivate: [roleGuard],
        data: { roles: ['admin', 'despachador', 'vendedor'] },
        loadComponent: () => import('./features/logistica/logistica.component').then(m => m.LogisticaComponent)
      },
      {
        path: 'reportes',
        canActivate: [roleGuard],
        data: { roles: ['admin'] },
        loadComponent: () => import('./features/reportes/reportes.component').then(m => m.ReportesComponent)
      },
      {
        path: 'configuracion',
        canActivate: [roleGuard],
        data: { roles: ['admin'] },
        loadComponent: () => import('./features/configuracion/configuracion.component').then(m => m.ConfiguracionComponent)
      },
      {
        path: 'clientes',
        canActivate: [roleGuard],
        data: { roles: ['admin', 'vendedor'] },
        loadComponent: () => import('./features/clientes/clientes.component').then(m => m.ClientesComponent)
      },

      {
        path: 'catalogo',
        canActivate: [roleGuard],
        data: { roles: ['admin', 'vendedor', 'despachador'] },
        loadComponent: () => import('./features/catalogo/catalogo.component').then(m => m.CatalogoComponent)
      },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' }
    ]
  },
  { path: 'sin-acceso', loadComponent: () => import('./features/sin-acceso/sin-acceso.component').then(m => m.SinAccesoComponent) },
  { path: '**', redirectTo: 'login' }
];
