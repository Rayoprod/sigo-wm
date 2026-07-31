import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ChartModule } from 'primeng/chart';
import { SupabaseService } from '../../core/services/supabase.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, TableModule, ChartModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  supabase = inject(SupabaseService).client;
  auth = inject(AuthService);

  isAdmin = false;
  totalClientes = 0;
  totalVentas = 0;
  montoVentas = 0;
  montoDeuda = 0;
  actividadReciente: any[] = [];
  deudasProximas: any[] = [];

  // Datos para gráficos
  ventasChartData: any;
  ventasChartOptions: any;
  despachosChartData: any;
  despachosChartOptions: any;

  async ngOnInit() {
    const roles = this.auth.currentUser()?.rol || [];
    this.isAdmin = Array.isArray(roles) ? roles.includes('admin') : roles === 'admin';
    if (!this.isAdmin) return;

    await Promise.all([
      this.loadClientesCount(),
      this.loadVentasStats(),
      this.loadActividadReciente(),
      this.loadDeudaStatus(),
      this.loadGraficosData()
    ]);
    this.initChartOptions();
  }

  async loadClientesCount() {
    const { count } = await this.supabase
      .from('clientes')
      .select('*', { count: 'exact', head: true });
    this.totalClientes = count || 0;
  }

  async loadVentasStats() {
    const { data } = await this.supabase
      .from('pedidos')
      .select('total')
      .eq('tipo_documento', 'ORDEN_VENTA')
      .neq('estado', 'ANULADA');

    if (data) {
      this.totalVentas = data.length;
      this.montoVentas = data.reduce((acc, curr) => acc + Number(curr.total || 0), 0);
    }
  }

  async loadDeudaStatus() {
    const { data } = await this.supabase
      .from('pedidos')
      .select(`
        id, folio, total, fecha_vencimiento, estado_pago,
        clientes (nombre_razon_social),
        pagos (monto_pagado)
      `)
      .eq('tipo_documento', 'ORDEN_VENTA')
      .neq('estado', 'ANULADA')
      .in('estado_pago', ['PENDIENTE', 'PARCIAL'])
      .order('fecha_vencimiento', { ascending: true });

    if (data) {
      let totalDeudaAcc = 0;
      const deudasDetalladas = data.map((p: any) => {
        const totalPagado = p.pagos ? p.pagos.reduce((acc: number, pago: any) => acc + Number(pago.monto_pagado || 0), 0) : 0;
        const saldo_pendiente = Number(p.total || 0) - totalPagado;
        if (saldo_pendiente > 0) totalDeudaAcc += saldo_pendiente;
        return { ...p, saldo_pendiente };
      }).filter((d: any) => d.saldo_pendiente > 0);

      this.montoDeuda = totalDeudaAcc;
      this.deudasProximas = deudasDetalladas.slice(0, 5);
    }
  }

  async loadActividadReciente() {
    const { data } = await this.supabase
      .from('pedidos')
      .select('folio, estado, total, created_at, clientes(nombre_razon_social)')
      .order('created_at', { ascending: false })
      .limit(5);

    if (data) this.actividadReciente = data;
  }

  initChartOptions() {
    const documentStyle = getComputedStyle(document.documentElement);
    const textColor = documentStyle.getPropertyValue('--text-color');
    const textColorSecondary = documentStyle.getPropertyValue('--text-color-secondary');
    const surfaceBorder = documentStyle.getPropertyValue('--surface-border');

    this.ventasChartOptions = {
      maintainAspectRatio: false,
      aspectRatio: 0.6,
      plugins: {
        legend: { labels: { color: textColor } }
      },
      scales: {
        x: { ticks: { color: textColorSecondary }, grid: { color: surfaceBorder, drawBorder: false } },
        y: { ticks: { color: textColorSecondary }, grid: { color: surfaceBorder, drawBorder: false } }
      }
    };

    this.despachosChartOptions = {
      plugins: {
        legend: { labels: { usePointStyle: true, color: textColor } }
      }
    };
  }

  async loadGraficosData() {
    // Gráfico 1: Ventas últimos 7 días
    const past7Days = new Date();
    past7Days.setDate(past7Days.getDate() - 6);
    past7Days.setHours(0, 0, 0, 0);

    const { data: ventasRecientes } = await this.supabase
      .from('pedidos')
      .select('total, created_at')
      .eq('tipo_documento', 'ORDEN_VENTA')
      .neq('estado', 'ANULADA')
      .gte('created_at', past7Days.toISOString())
      .order('created_at', { ascending: true });

    const labels7Days: string[] = [];
    const ventasPorDia = Array(7).fill(0);

    for (let i = 0; i < 7; i++) {
      const d = new Date(past7Days);
      d.setDate(d.getDate() + i);
      labels7Days.push(d.toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric' }));
    }

    if (ventasRecientes) {
      ventasRecientes.forEach((v: any) => {
        const fechaVenta = new Date(v.created_at);
        fechaVenta.setHours(fechaVenta.getHours() - 5); // UTC-5 Perú
        const today = new Date();
        const diffTime = today.getTime() - fechaVenta.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 3600 * 24));
        const arrayIndex = 6 - diffDays;
        if (arrayIndex >= 0 && arrayIndex < 7) {
          ventasPorDia[arrayIndex] += Number(v.total || 0);
        }
      });
    }

    const documentStyle = getComputedStyle(document.documentElement);
    this.ventasChartData = {
      labels: labels7Days,
      datasets: [
        {
          label: 'Ventas Diarias (S/)',
          data: ventasPorDia,
          fill: true,
          borderColor: documentStyle.getPropertyValue('--blue-500'),
          backgroundColor: 'rgba(59,130,246,0.08)',
          tension: 0.4
        }
      ]
    };

    // Gráfico 2: Viajes por Estado — estados reales: ASIGNADO, EN RUTA, ENTREGADO
    const { data: despachos } = await this.supabase
      .from('despachos_viajes_cabecera')
      .select('estado_viaje');

    let asignados = 0;
    let enRuta = 0;
    let entregados = 0;

    if (despachos) {
      despachos.forEach((d: any) => {
        if (d.estado_viaje === 'ASIGNADO') asignados++;
        else if (d.estado_viaje === 'EN RUTA') enRuta++;
        else if (d.estado_viaje === 'ENTREGADO') entregados++;
      });
    }

    this.despachosChartData = {
      labels: ['Asignados', 'En Ruta', 'Entregados'],
      datasets: [
        {
          data: [asignados, enRuta, entregados],
          backgroundColor: [
            documentStyle.getPropertyValue('--orange-400'),
            documentStyle.getPropertyValue('--blue-400'),
            documentStyle.getPropertyValue('--green-400')
          ],
          hoverBackgroundColor: [
            documentStyle.getPropertyValue('--orange-500'),
            documentStyle.getPropertyValue('--blue-500'),
            documentStyle.getPropertyValue('--green-500')
          ]
        }
      ]
    };
  }
}
