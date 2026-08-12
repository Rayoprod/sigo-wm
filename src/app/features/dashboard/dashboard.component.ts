import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartModule } from 'primeng/chart';
import { Subscription } from 'rxjs';
import { SupabaseService } from '../../core/services/supabase.service';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ChartModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit, OnDestroy {
  supabase = inject(SupabaseService).client;
  auth = inject(AuthService);
  private themeService = inject(ThemeService);
  private themeSub?: Subscription;

  canViewDashboard = false;
  totalClientes = 0;
  totalVentas = 0;
  montoVentas = 0;
  montoDeuda = 0;

  // Datos para gráficos
  topClientesChartData: any;
  topClientesChartOptions: any;
  ventasDiaSemanaChartData: any;
  ventasDiaSemanaChartOptions: any;
  cargandoGraficos = false;
  totalMesVentas = 0;

  // Analista de Negocio (Insights)
  predictiveInsights: string[] = [];

  async ngOnInit() {
    this.canViewDashboard = this.auth.hasRole('admin', 'vendedor');

    if (!this.canViewDashboard) return;

    await Promise.all([
      this.loadClientesCount(),
      this.loadVentasStats(),
      this.loadDeudaStatus(),
      this.loadGraficosData()
    ]);
    this.initChartOptions();

    // Re-inicializar colores de gráficos cuando cambia el tema.
    // themeChange$ emite DESPUÉS de que el nuevo CSS haya cargado,
    // por lo que getComputedStyle ya devuelve los valores correctos.
    this.themeSub = this.themeService.themeChange$.subscribe(() => {
      this.initChartOptions();
    });
  }

  ngOnDestroy() {
    this.themeSub?.unsubscribe();
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
        total, estado_pago,
        pagos (monto_pagado)
      `)
      .eq('tipo_documento', 'ORDEN_VENTA')
      .neq('estado', 'ANULADA')
      .in('estado_pago', ['PENDIENTE', 'PARCIAL']);

    let totalDeudaAcc = 0;
    (data || []).forEach((p: any) => {
      const totalPagado = p.pagos ? p.pagos.reduce((acc: number, pago: any) => acc + Number(pago.monto_pagado || 0), 0) : 0;
      const saldo = Number(p.total || 0) - totalPagado;
      if (saldo > 0) totalDeudaAcc += saldo;
    });
    this.montoDeuda = totalDeudaAcc;
  }

  initChartOptions() {
    const documentStyle = getComputedStyle(document.documentElement);
    const textColorSecondary = documentStyle.getPropertyValue('--text-color-secondary');
    const surfaceBorder = documentStyle.getPropertyValue('--surface-border');

    this.topClientesChartOptions = {
      maintainAspectRatio: false,
      aspectRatio: 0.6,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx: any) => {
              const valor = Number(ctx.raw || 0);
              const pct = this.totalMesVentas > 0 ? ((valor / this.totalMesVentas) * 100).toFixed(0) : '0';
              return ` S/ ${valor.toLocaleString('es-PE')} · ${pct}% del mes`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: textColorSecondary, callback: (v: any) => this.fmtCompacto(Number(v)) }, grid: { color: surfaceBorder, drawBorder: false } },
        y: { ticks: { color: textColorSecondary }, grid: { display: false } }
      }
    };

    this.ventasDiaSemanaChartOptions = {
      maintainAspectRatio: false,
      aspectRatio: 0.6,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx: any) => {
              const valor = Number(ctx.raw || 0);
              const pct = this.totalMesVentas > 0 ? ((valor / this.totalMesVentas) * 100).toFixed(0) : '0';
              return ` S/ ${valor.toLocaleString('es-PE')} · ${pct}% del mes`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: textColorSecondary }, grid: { display: false } },
        y: {
          ticks: { color: textColorSecondary, callback: (v: any) => this.fmtCompacto(Number(v)) },
          grid: { color: surfaceBorder, drawBorder: false }
        }
      }
    };
  }

  async loadGraficosData() {
    this.cargandoGraficos = true;
    try {
      await Promise.all([
        this.cargarAnalisisVentas(),
        this.cargarVentasPorDiaSemana()
      ]);
    } catch (e) {
      console.error('Error cargando gráficos', e);
    } finally {
      this.cargandoGraficos = false;
    }
  }

  /** Top 10 clientes por ingresos (últimos 30 días) con análisis ABC. */
  private async cargarAnalisisVentas() {
    const hace30dias = new Date();
    hace30dias.setDate(hace30dias.getDate() - 29);
    hace30dias.setHours(0, 0, 0, 0);

    const { data: ventas } = await this.supabase
      .from('pedidos')
      .select('total, clientes(nombre_razon_social)')
      .eq('tipo_documento', 'ORDEN_VENTA')
      .neq('estado', 'ANULADA')
      .gte('created_at', hace30dias.toISOString());

    const clienteMap = new Map<string, number>();
    let totalMonto = 0;
    let totalPedidos = 0;

    (ventas || []).forEach((v: any) => {
      const nombre = v.clientes?.nombre_razon_social || 'Consumidor Final';
      const monto = Number(v.total || 0);
      clienteMap.set(nombre, (clienteMap.get(nombre) || 0) + monto);
      totalMonto += monto;
      totalPedidos++;
    });

    this.totalMesVentas = totalMonto;

    const top = Array.from(clienteMap.entries())
      .map(([nombre, monto]) => ({ nombre, monto }))
      .sort((a, b) => b.monto - a.monto)
      .slice(0, 10);

    if (top.length === 0) {
      this.topClientesChartData = null;
      this.generarInsights();
      return;
    }

    const pctAcumulado: number[] = [];
    let acumulado = 0;
    top.forEach((c) => {
      acumulado += c.monto;
      pctAcumulado.push(totalMonto > 0 ? (acumulado / totalMonto) * 100 : 0);
    });

    const documentStyle = getComputedStyle(document.documentElement);
    const colorAzul = documentStyle.getPropertyValue('--blue-500') || '#3B82F6';
    const colorMorado = documentStyle.getPropertyValue('--purple-500') || '#8B5CF6';
    const colorRojo = documentStyle.getPropertyValue('--red-400') || '#F87171';

    const backgroundColor = top.map((_, i) => {
      const pct = pctAcumulado[i];
      if (pct <= 80) return colorAzul;   // A
      if (pct <= 95) return colorMorado; // B
      return colorRojo;                  // C
    });

    this.topClientesChartData = {
      labels: top.map(c => c.nombre),
      datasets: [
        {
          label: 'Ingresos (S/)',
          data: top.map(c => Math.round(c.monto)),
          backgroundColor,
          borderRadius: 6,
          maxBarThickness: 18
        }
      ]
    };

    // ── Cálculos para los insights ──
    this.generarInsights();
  }

  /** Distribución de ventas (S/) por día de la semana, últimos 30 días. */
  private async cargarVentasPorDiaSemana() {
    const hace30dias = new Date();
    hace30dias.setDate(hace30dias.getDate() - 29);
    hace30dias.setHours(0, 0, 0, 0);

    const { data: ventas } = await this.supabase
      .from('pedidos')
      .select('total, created_at')
      .eq('tipo_documento', 'ORDEN_VENTA')
      .neq('estado', 'ANULADA')
      .gte('created_at', hace30dias.toISOString());

    // [Dom, Lun, Mar, Mié, Jue, Vie, Sáb]
    const ventasPorDiaSemana = [0, 0, 0, 0, 0, 0, 0];

    (ventas || []).forEach((v: any) => {
      if (!v.created_at) return;
      const safeStr = typeof v.created_at === 'string' ? v.created_at.replace(' ', 'T') : v.created_at;
      const fecha = new Date(safeStr);
      if (isNaN(fecha.getTime())) return;
      // La BD guarda fechas en UTC; el día real en Perú (UTC-5) puede caer
      // un día antes. Convertimos a hora local de Perú antes de leer el día.
      const diaLocal = new Date(fecha.getTime() - 5 * 60 * 60 * 1000).getUTCDay();
      ventasPorDiaSemana[diaLocal] += Number(v.total || 0);
    });

    if (!ventasPorDiaSemana.some(v => v > 0)) {
      this.ventasDiaSemanaChartData = null;
      return;
    }

    this.ventasDiaSemanaChartData = {
      labels: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
      datasets: [
        {
          label: 'Ventas (S/)',
          data: ventasPorDiaSemana.map(v => Math.round(v)),
          backgroundColor: 'rgba(139,92,246,0.8)',
          borderRadius: 6,
          maxBarThickness: 32
        }
      ]
    };
  }

  private generarInsights() {
    this.predictiveInsights = [];
    const days = 30;

    const montoPromedioDia = this.montoVentas / days;
    const pctDeuda = this.montoVentas > 0 ? (this.montoDeuda / this.montoVentas) * 100 : 0;
    const ticketPromedio = this.totalVentas > 0 ? this.montoVentas / this.totalVentas : 0;

    // 1. Proyección de ventas
    if (montoPromedioDia > 0) {
      this.predictiveInsights.push(`📈 <b>Ritmo de Ventas:</b> facturas <b>S/ ${this.fmtCompacto(montoPromedioDia)}</b> al día en promedio, unos <b>S/ ${this.fmtCompacto(montoPromedioDia * 30)}</b> proyectados para los próximos 30 días si se mantiene el ritmo.`);
    } else {
      this.predictiveInsights.push(`📊 <b>Sin ventas registradas</b> en los últimos ${days} días.`);
    }

    // 2. Ticket promedio
    if (ticketPromedio > 0) {
      this.predictiveInsights.push(`🧾 <b>Ticket promedio:</b> S/ ${this.fmtCompacto(ticketPromedio)} por orden.`);
    }

    // 3. Concentración de clientes
    const clientesTop = this.topClientesChartData?.labels?.length || 0;
    if (clientesTop > 0) {
      const top3 = this.topClientesChartData.datasets[0].data.slice(0, 3);
      const pctTop3 = this.totalMesVentas > 0
        ? ((top3.reduce((a: number, b: number) => a + b, 0) / this.totalMesVentas) * 100).toFixed(0)
        : '0';
      this.predictiveInsights.push(`👥 <b>Concentración:</b> tus ${clientesTop} mejores clientes generan el <b>${pctTop3}%</b> de los ingresos del mes.`);
    }

    // 4. Mejor día de la semana
    const diasSemana = this.ventasDiaSemanaChartData?.labels || [];
    const valores = this.ventasDiaSemanaChartData?.datasets?.[0]?.data || [];
    if (valores.length === 7 && valores.some((v: number) => v > 0)) {
      const mejorIndice = valores.indexOf(Math.max(...valores));
      const mejorDia = diasSemana[mejorIndice];
      const pct = this.totalMesVentas > 0
        ? ((valores[mejorIndice] / this.totalMesVentas) * 100).toFixed(0)
        : '0';
      this.predictiveInsights.push(`🗓️ <b>Momento ideal:</b> los <b>${mejorDia}s</b> concentran el ${pct}% de tus ventas. Agenda visitas o campañas ese día.`);
    }

    // 5. Cobranza
    if (pctDeuda > 30) {
      this.predictiveInsights.push(`💰 <b>Alerta de Liquidez:</b> tu deuda por cobrar equivale al <b>${pctDeuda.toFixed(0)}%</b> de tus ingresos totales. Urge gestión de cobranza.`);
    } else if (pctDeuda > 0) {
      this.predictiveInsights.push(`💳 <b>Cobranza Saludable:</b> tu deuda por cobrar es solo el <b>${pctDeuda.toFixed(0)}%</b> de tus ingresos.`);
    } else {
      this.predictiveInsights.push(`✅ <b>Sin deudas pendientes.</b>`);
    }
  }

  /** Formatea números grandes de forma compacta: 12500 → "12.5k", 1500000 → "1.5M". */
  private fmtCompacto(num: number): string {
    if (Math.abs(num) >= 1000000) return (num / 1000000).toFixed(1).replace('.0', '') + 'M';
    if (Math.abs(num) >= 1000) return (num / 1000).toFixed(1).replace('.0', '') + 'k';
    return num.toLocaleString('es-PE');
  }
}
