import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { TabViewModule } from 'primeng/tabview';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { CalendarModule } from 'primeng/calendar';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { ChipModule } from 'primeng/chip';
import { ChartModule } from 'primeng/chart';
import { Subscription } from 'rxjs';
import { SupabaseService } from '../../core/services/supabase.service';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';
import { PeruDatePipe } from '../../shared/pipes/peru-date.pipe';

@Component({
  selector: 'app-reportes',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    TabViewModule,
    ButtonModule,
    TagModule,
    CalendarModule,
    DropdownModule,
    InputTextModule,
    ChipModule,
    ChartModule,
    PeruDatePipe
  ],
  templateUrl: './reportes.component.html',
  styleUrl: './reportes.component.scss'
})
export class ReportesComponent implements OnInit, OnDestroy {
  private supabase = inject(SupabaseService).client;
  auth = inject(AuthService);
  private themeService = inject(ThemeService);
  private themeSub?: Subscription;

  // ── ESTADOS DE CARGA ──────────────────────────────────────────────
  loadingVentas = false;
  loadingDeudas = false;
  loadingInventario = false;
  loadingLogistica = false;
  cargandoGraficos = false;

  // ── PESTAÑA 1: DASHBOARD GERENCIAL ───────────────────────────────
  totalClientes = 0;
  totalVentas = 0;
  montoVentas = 0;
  montoDeuda = 0;
  totalMesVentas = 0;
  topClientesChartData: any;
  topClientesChartOptions: any;
  ventasDiaSemanaChartData: any;
  ventasDiaSemanaChartOptions: any;
  predictiveInsights: string[] = [];

  // ── PESTAÑA 2: VENTAS Y FINANZAS ─────────────────────────────────
  ventas: any[] = [];
  fechaInicioVentas: Date | null = null;
  fechaFinVentas: Date | null = null;
  estadosVentas = [
    { label: 'Todos', value: null },
    { label: 'Aprobada', value: 'APROBADA' },
    { label: 'Completada', value: 'COMPLETADA' },
    { label: 'Cotización', value: 'COTIZACION' },
    { label: 'Anulada', value: 'ANULADA' }
  ];
  estadoVentaFiltro: string | null = null;

  // KPIs dinámicos del periodo filtrado
  ventasTotalPeriodo = 0;
  ventasCobradoPeriodo = 0;
  ventasSaldoPeriodo = 0;
  ticketPromedioPeriodo = 0;

  // ── PESTAÑA 3: CUENTAS POR COBRAR (AGING DE DEUDA) ───────────────
  deudas: any[] = [];
  deudaTotalVencida = 0;
  deudaTotalPorVencer = 0;
  deudaTotalVigente = 0;
  deudaClientesCount = 0;

  // ── PESTAÑA 4: LOGÍSTICA Y FLOTA ──────────────────────────────────
  totalViajesDespachados = 0;
  viajesEntregadosCount = 0;
  tiempoPromedioDespachoMinutos = 0;
  flotaVehiculos: any[] = [];
  desempenoChoferes: any[] = [];

  // ── PESTAÑA 5: INVENTARIO Y MATERIALES ────────────────────────────
  inventario: any[] = [];
  topProductosVendidos: any[] = [];
  totalValorizadoInventario = 0;
  productosBajoMinimoCount = 0;

  // ── COLUMNAS DE EXPORTACIÓN EXCEL ─────────────────────────────────
  colsVentas = [
    { field: 'fecha_formateada', header: 'Fecha' },
    { field: 'folio', header: 'Folio' },
    { field: 'tipo_documento', header: 'Tipo Doc.' },
    { field: 'cliente_nombre', header: 'Cliente' },
    { field: 'cliente_doc', header: 'Doc. Cliente' },
    { field: 'cliente_telefono', header: 'Teléfono' },
    { field: 'tipo_entrega_label', header: 'Tipo Entrega' },
    { field: 'subtotal', header: 'Subtotal (S/)' },
    { field: 'igv', header: 'IGV (S/)' },
    { field: 'total', header: 'Total (S/)' },
    { field: 'total_pagado', header: 'Total Pagado (S/)' },
    { field: 'saldo_pendiente', header: 'Saldo Pendiente (S/)' },
    { field: 'metodo_pago', header: 'Método Pago' },
    { field: 'estado_pago', header: 'Estado Pago' },
    { field: 'estado', header: 'Estado Doc.' }
  ];

  colsDeudas = [
    { field: 'fecha_formateada', header: 'Fecha Emisión' },
    { field: 'folio', header: 'Folio' },
    { field: 'cliente_nombre', header: 'Cliente' },
    { field: 'cliente_telefono', header: 'Teléfono' },
    { field: 'fecha_vencimiento_str', header: 'Vencimiento' },
    { field: 'dias_mora_texto', header: 'Estado Mora' },
    { field: 'total', header: 'Total (S/)' },
    { field: 'total_pagado', header: 'Abonado (S/)' },
    { field: 'saldo_pendiente', header: 'Saldo Pendiente (S/)' }
  ];

  colsLogistica = [
    { field: 'placa', header: 'Placa del Camión' },
    { field: 'total_viajes', header: 'Total Viajes' },
    { field: 'viajes_entregados', header: 'Entregados en Obra' },
    { field: 'viajes_en_ruta', header: 'En Ruta / Asignados' },
    { field: 'ultimo_viaje', header: 'Último Viaje' }
  ];

  colsInventario = [
    { field: 'descripcion', header: 'Producto / Material' },
    { field: 'unidad_medida', header: 'Unidad' },
    { field: 'stock_actual', header: 'Stock Físico' },
    { field: 'stock_minimo', header: 'Stock Mínimo' },
    { field: 'precio_unitario_base', header: 'Precio Base (S/)' },
    { field: 'valor_inmovilizado', header: 'Valor Inmovilizado (S/)' }
  ];

  async ngOnInit() {
    await Promise.all([
      this.cargarDatosDashboard(),
      this.cargarVentas(),
      this.cargarDeudas(),
      this.cargarLogistica(),
      this.cargarInventario()
    ]);

    this.initChartOptions();

    // Re-render de gráficos cuando cambia el tema
    this.themeSub = this.themeService.themeChange$.subscribe(() => {
      this.initChartOptions();
    });
  }

  ngOnDestroy() {
    this.themeSub?.unsubscribe();
  }

  // ══════════════════════════════════════════════════════════════════
  // PESTAÑA 1: DASHBOARD & ANALÍTICA DE NEGOCIOS
  // ══════════════════════════════════════════════════════════════════

  async cargarDatosDashboard() {
    this.cargandoGraficos = true;
    try {
      await Promise.all([
        this.loadClientesCount(),
        this.loadVentasStats(),
        this.loadDeudaStatus(),
        this.cargarAnalisisVentas(),
        this.cargarVentasPorDiaSemana()
      ]);
    } catch (e) {
      console.error('Error cargando métricas de dashboard', e);
    } finally {
      this.cargandoGraficos = false;
    }
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
      .select('total, monto_pagado')
      .eq('tipo_documento', 'ORDEN_VENTA')
      .neq('estado', 'ANULADA')
      .in('estado_pago', ['PENDIENTE', 'PARCIAL']);

    let totalDeudaAcc = 0;
    (data || []).forEach((p: any) => {
      const saldo = Number(p.total || 0) - Number(p.monto_pagado || 0);
      if (saldo > 0) totalDeudaAcc += saldo;
    });
    this.montoDeuda = totalDeudaAcc;
  }

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

    (ventas || []).forEach((v: any) => {
      const nombre = v.clientes?.nombre_razon_social || 'Consumidor Final';
      const monto = Number(v.total || 0);
      clienteMap.set(nombre, (clienteMap.get(nombre) || 0) + monto);
      totalMonto += monto;
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
      if (pct <= 80) return colorAzul;
      if (pct <= 95) return colorMorado;
      return colorRojo;
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

    this.generarInsights();
  }

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

    const ventasPorDiaSemana = [0, 0, 0, 0, 0, 0, 0];

    (ventas || []).forEach((v: any) => {
      if (!v.created_at) return;
      const safeStr = typeof v.created_at === 'string' ? v.created_at.replace(' ', 'T') : v.created_at;
      const fecha = new Date(safeStr);
      if (isNaN(fecha.getTime())) return;
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

    const montoPromedioDia = (this.totalMesVentas || 0) / days;
    const pctDeuda = this.montoVentas > 0 ? (this.montoDeuda / this.montoVentas) * 100 : 0;
    const ticketPromedio = this.totalVentas > 0 ? this.montoVentas / this.totalVentas : 0;

    if (montoPromedioDia > 0) {
      this.predictiveInsights.push(`📈 <b>Ritmo de Facturación:</b> generas <b>S/ ${this.fmtCompacto(montoPromedioDia)}</b> al día en promedio, con una proyección de <b>S/ ${this.fmtCompacto(montoPromedioDia * 30)}</b> para el mes.`);
    }

    if (ticketPromedio > 0) {
      this.predictiveInsights.push(`🧾 <b>Ticket Promedio:</b> S/ ${this.fmtCompacto(ticketPromedio)} por cada orden de venta emitida.`);
    }

    const clientesTop = this.topClientesChartData?.labels?.length || 0;
    if (clientesTop > 0) {
      const top3 = this.topClientesChartData.datasets[0].data.slice(0, 3);
      const pctTop3 = this.totalMesVentas > 0
        ? ((top3.reduce((a: number, b: number) => a + b, 0) / this.totalMesVentas) * 100).toFixed(0)
        : '0';
      this.predictiveInsights.push(`👥 <b>Concentración de Clientes:</b> tus 3 clientes principales representan el <b>${pctTop3}%</b> de las ventas del mes.`);
    }

    const diasSemana = this.ventasDiaSemanaChartData?.labels || [];
    const valores = this.ventasDiaSemanaChartData?.datasets?.[0]?.data || [];
    if (valores.length === 7 && valores.some((v: number) => v > 0)) {
      const mejorIndice = valores.indexOf(Math.max(...valores));
      const mejorDia = diasSemana[mejorIndice];
      const pct = this.totalMesVentas > 0
        ? ((valores[mejorIndice] / this.totalMesVentas) * 100).toFixed(0)
        : '0';
      this.predictiveInsights.push(`🗓️ <b>Día Pico:</b> los <b>${mejorDia}s</b> concentran el <b>${pct}%</b> de las operaciones de compra.`);
    }

    if (pctDeuda > 30) {
      this.predictiveInsights.push(`⚠️ <b>Alerta de Cartera:</b> el saldo por cobrar equivale al <b>${pctDeuda.toFixed(0)}%</b> de las ventas totales. Se recomienda priorizar la cobranza.`);
    } else if (pctDeuda > 0) {
      this.predictiveInsights.push(`✅ <b>Cobranza Controlada:</b> el saldo pendiente representa solo el <b>${pctDeuda.toFixed(0)}%</b> de los ingresos acumulados.`);
    }
  }

  initChartOptions() {
    const documentStyle = getComputedStyle(document.documentElement);
    const textColor = documentStyle.getPropertyValue('--text-color') || '#4B5563';
    const textColorSecondary = documentStyle.getPropertyValue('--text-color-secondary') || '#9CA3AF';
    const surfaceBorder = documentStyle.getPropertyValue('--surface-border') || '#E5E7EB';

    this.topClientesChartOptions = {
      indexAxis: 'y',
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx: any) => ` S/ ${Number(ctx.raw).toLocaleString('es-PE')}`
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: textColorSecondary,
            callback: (val: number) => this.fmtCompacto(val)
          },
          grid: { color: surfaceBorder }
        },
        y: {
          ticks: { color: textColor },
          grid: { display: false }
        }
      }
    };

    this.ventasDiaSemanaChartOptions = {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx: any) => ` S/ ${Number(ctx.raw).toLocaleString('es-PE')}`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: textColor },
          grid: { display: false }
        },
        y: {
          ticks: {
            color: textColorSecondary,
            callback: (val: number) => this.fmtCompacto(val)
          },
          grid: { color: surfaceBorder }
        }
      }
    };
  }

  // ══════════════════════════════════════════════════════════════════
  // PESTAÑA 2: HISTORIAL DE VENTAS Y FINANZAS
  // ══════════════════════════════════════════════════════════════════

  async cargarVentas() {
    this.loadingVentas = true;
    try {
      let query = this.supabase
        .from('pedidos')
        .select(`
          id,
          folio,
          created_at,
          estado,
          tipo_documento,
          subtotal,
          descuento_global,
          igv,
          total,
          precios_con_igv,
          tipo_entrega,
          lugar_entrega,
          direccion_entrega_detalle,
          estado_pago,
          folio_cotizacion_origen,
          clientes ( nombre_razon_social, documento_identidad, telefono ),
          pagos ( monto_pagado, metodo_pago )
        `)
        .order('created_at', { ascending: false });

      if (this.estadoVentaFiltro) {
        query = query.eq('estado', this.estadoVentaFiltro);
      }

      if (this.fechaInicioVentas) {
        const fromDate = new Date(this.fechaInicioVentas);
        if (!isNaN(fromDate.getTime())) {
          fromDate.setHours(0, 0, 0, 0);
          query = query.gte('created_at', fromDate.toISOString());
        }
      }

      if (this.fechaFinVentas) {
        const toDate = new Date(this.fechaFinVentas);
        if (!isNaN(toDate.getTime())) {
          toDate.setHours(23, 59, 59, 999);
          query = query.lte('created_at', toDate.toISOString());
        }
      }

      const { data, error } = await query;
      if (error) throw error;

      let sumTotal = 0;
      let sumPagado = 0;
      let sumSaldo = 0;

      this.ventas = (data || []).map(v => {
        const pagos = (v.pagos as any[]) || [];
        const pagado = pagos.reduce((sum: number, p: any) => sum + Number(p.monto_pagado), 0);
        const rawSaldo = Number(v.total) - pagado;
        const saldo = Math.round(rawSaldo * 100) / 100;
        const metodos = [...new Set(pagos.map((p: any) => p.metodo_pago).filter(Boolean))].join(', ');
        const safeDateStr = typeof v.created_at === 'string' ? v.created_at.replace(' ', 'T') : v.created_at;
        const dDate = safeDateStr ? new Date(safeDateStr) : new Date();
        const isFechaValid = !isNaN(dDate.getTime());
        const tipoEntregaMap: Record<string, string> = {
          DOMICILIO: 'Entrega en Obra',
          CANTERA: 'Recojo en Cantera'
        };

        const totalNum = Number(v.total) || 0;
        sumTotal += totalNum;
        sumPagado += pagado;
        sumSaldo += (saldo > 0 ? saldo : 0);

        return {
          ...v,
          saldo_pendiente: saldo,
          total_pagado: pagado,
          fecha_formateada: isFechaValid ? (dDate.toLocaleDateString('es-PE') + ' ' + dDate.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })) : 'N/A',
          cliente_nombre: (v.clientes as any)?.nombre_razon_social || 'Consumidor Final',
          cliente_doc: (v.clientes as any)?.documento_identidad || '',
          cliente_telefono: (v.clientes as any)?.telefono || '',
          tipo_entrega_label: tipoEntregaMap[(v as any).tipo_entrega] || (v as any).tipo_entrega || '',
          metodo_pago: metodos || 'Sin registro',
          subtotal: Number((v as any).subtotal) || 0,
          descuento_global: Number((v as any).descuento_global) || 0,
          igv: Number((v as any).igv) || 0,
          precios_con_igv: (v as any).precios_con_igv === true
        };
      });

      this.ventasTotalPeriodo = sumTotal;
      this.ventasCobradoPeriodo = sumPagado;
      this.ventasSaldoPeriodo = sumSaldo;
      this.ticketPromedioPeriodo = this.ventas.length > 0 ? (sumTotal / this.ventas.length) : 0;

    } catch (e) {
      console.error('Error cargando ventas:', e);
    } finally {
      this.loadingVentas = false;
    }
  }

  aplicarFiltrosVentas() {
    this.cargarVentas();
  }

  // ══════════════════════════════════════════════════════════════════
  // PESTAÑA 3: CUENTAS POR COBRAR (AGING & COBRANZAS)
  // ══════════════════════════════════════════════════════════════════

  async cargarDeudas() {
    this.loadingDeudas = true;
    try {
      const { data, error } = await this.supabase
        .from('pedidos')
        .select(`
          id,
          folio,
          created_at,
          total,
          monto_pagado,
          estado_pago,
          estado,
          dias_credito,
          fecha_vencimiento,
          cliente_id,
          clientes ( nombre_razon_social, telefono, documento_identidad ),
          pagos ( monto_pagado )
        `)
        .eq('tipo_documento', 'ORDEN_VENTA')
        .neq('estado', 'COTIZACION')
        .neq('estado', 'ANULADA')
        .order('created_at', { ascending: true });

      if (error) throw error;

      let vencidaAcc = 0;
      let porVencerAcc = 0;
      let vigenteAcc = 0;
      const clientesUnicos = new Set<string>();
      const ahora = new Date();

      const deudasConSaldo: any[] = [];

      for (const d of (data || [])) {
        const pagadoFromPayments = d.pagos?.reduce((sum: number, p: any) => sum + Number(p.monto_pagado), 0) || 0;
        const totalPagado = d.monto_pagado !== null && d.monto_pagado !== undefined ? Number(d.monto_pagado) : pagadoFromPayments;
        const rawSaldo = Number(d.total) - totalPagado;
        const saldo = Math.round(rawSaldo * 100) / 100;

        // Si ya está totalmente pagado o sin saldo deudor, no cuenta como deuda
        if (saldo <= 0.01) continue;

        const safeDateStr = typeof d.created_at === 'string' ? d.created_at.replace(' ', 'T') : d.created_at;
        const fechaEmision = safeDateStr ? new Date(safeDateStr) : new Date();

        // Determinar fecha de vencimiento
        let fechaVenc: Date;
        if (d.fecha_vencimiento) {
          fechaVenc = new Date(d.fecha_vencimiento);
        } else if (d.dias_credito && d.dias_credito > 0) {
          fechaVenc = new Date(fechaEmision.getTime() + (d.dias_credito * 24 * 60 * 60 * 1000));
        } else {
          // Si no tiene plazo explícito, se asigna 7 días por defecto
          fechaVenc = new Date(fechaEmision.getTime() + (7 * 24 * 60 * 60 * 1000));
        }

        const msDiferencia = ahora.getTime() - fechaVenc.getTime();
        const diasDiferencia = Math.floor(msDiferencia / (1000 * 60 * 60 * 24));

        let estadoMora: 'VENCIDO' | 'POR_VENCER' | 'VIGENTE';
        let diasMoraTexto: string;

        if (diasDiferencia > 0) {
          estadoMora = 'VENCIDO';
          diasMoraTexto = `Vencido hace ${diasDiferencia} d`;
          vencidaAcc += saldo;
        } else if (diasDiferencia >= -5) {
          estadoMora = 'POR_VENCER';
          diasMoraTexto = `Vence en ${Math.abs(diasDiferencia)} d`;
          porVencerAcc += saldo;
        } else {
          estadoMora = 'VIGENTE';
          diasMoraTexto = 'Vigente';
          vigenteAcc += saldo;
        }

        const nombreCliente = (d.clientes as any)?.nombre_razon_social || 'Consumidor Final';
        const clienteKey = (d as any).cliente_id || (d.clientes as any)?.documento_identidad || nombreCliente;
        clientesUnicos.add(clienteKey);

        deudasConSaldo.push({
          ...d,
          total_pagado: totalPagado,
          saldo_pendiente: saldo,
          fecha_formateada: !isNaN(fechaEmision.getTime()) ? fechaEmision.toLocaleDateString('es-PE') : 'N/A',
          fecha_vencimiento_str: !isNaN(fechaVenc.getTime()) ? fechaVenc.toLocaleDateString('es-PE') : 'N/A',
          estado_mora: estadoMora,
          dias_mora_texto: diasMoraTexto,
          cliente_nombre: nombreCliente,
          cliente_telefono: (d.clientes as any)?.telefono || '',
          cliente_doc: (d.clientes as any)?.documento_identidad || ''
        });
      }

      this.deudas = deudasConSaldo;
      this.deudaTotalVencida = vencidaAcc;
      this.deudaTotalPorVencer = porVencerAcc;
      this.deudaTotalVigente = vigenteAcc;
      this.deudaClientesCount = clientesUnicos.size;

    } catch (e) {
      console.error('Error cargando cuentas por cobrar:', e);
    } finally {
      this.loadingDeudas = false;
    }
  }

  enviarCobranzaWhatsApp(deuda: any) {
    const rawTel = (deuda.cliente_telefono || '').replace(/\D/g, '');
    if (!rawTel) {
      alert('Este cliente no tiene número telefónico registrado.');
      return;
    }
    const tel = rawTel.length === 9 ? `51${rawTel}` : rawTel;
    const msg = encodeURIComponent(
      `Hola ${deuda.cliente_nombre}, le saludamos de Electro Ferretero W&M. Le recordamos que su pedido ${deuda.folio} mantiene un saldo pendiente de S/ ${deuda.saldo_pendiente.toFixed(2)}. Le agradecemos coordinar su regularización. ¡Muchas gracias!`
    );
    window.open(`https://wa.me/${tel}?text=${msg}`, '_blank');
  }

  // ══════════════════════════════════════════════════════════════════
  // PESTAÑA 4: LOGÍSTICA, FLOTA Y RENDIMIENTO DE DESPACHOS
  // ══════════════════════════════════════════════════════════════════

  async cargarLogistica() {
    this.loadingLogistica = true;
    try {
      const { data: viajes, error } = await this.supabase
        .from('despachos_viajes_cabecera')
        .select(`
          id,
          numero_viaje_secuencial,
          placa_vehiculo,
          estado_viaje,
          created_at,
          fecha_recepcion_chofer,
          chofer_id,
          usuarios:chofer_id ( nombre_completo, correo )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      this.totalViajesDespachados = (viajes || []).length;

      // Agrupación por placa de vehículo
      const placasMap = new Map<string, { total: number; entregados: number; enRuta: number; ultimo: string }>();
      const choferesMap = new Map<string, { total: number; entregados: number; minutosTotales: number; countTiempos: number }>();

      let minutosAcumulados = 0;
      let viajesConTiempo = 0;
      let entregadosCount = 0;

      (viajes || []).forEach(v => {
        const placa = (v.placa_vehiculo || 'SIN PLACA').trim().toUpperCase();
        const estado = (v.estado_viaje || '').toUpperCase();
        const esEntregado = estado === 'ENTREGADO';
        if (esEntregado) entregadosCount++;

        // Flota por vehículo
        const curPlaca = placasMap.get(placa) || { total: 0, entregados: 0, enRuta: 0, ultimo: '' };
        curPlaca.total++;
        if (esEntregado) curPlaca.entregados++;
        else curPlaca.enRuta++;
        if (!curPlaca.ultimo && v.created_at) {
          const d = new Date(v.created_at);
          curPlaca.ultimo = !isNaN(d.getTime()) ? d.toLocaleDateString('es-PE') : '';
        }
        placasMap.set(placa, curPlaca);

        // Desempeño por chofer
        const choferNombre = (v.usuarios as any)?.nombre_completo || 'Chofer Asignado';
        const curChofer = choferesMap.get(choferNombre) || { total: 0, entregados: 0, minutosTotales: 0, countTiempos: 0 };
        curChofer.total++;
        if (esEntregado) curChofer.entregados++;

        // Cálculo de tiempos de preparación / despacho
        if (v.created_at && v.fecha_recepcion_chofer) {
          const tInicio = new Date(v.created_at).getTime();
          const tRecep = new Date(v.fecha_recepcion_chofer).getTime();
          if (tRecep > tInicio) {
            const min = Math.round((tRecep - tInicio) / (1000 * 60));
            if (min >= 0 && min < 600) { // filtrar outliers extremos de pruebas
              minutosAcumulados += min;
              viajesConTiempo++;
              curChofer.minutosTotales += min;
              curChofer.countTiempos++;
            }
          }
        }
        choferesMap.set(choferNombre, curChofer);
      });

      this.viajesEntregadosCount = entregadosCount;
      this.tiempoPromedioDespachoMinutos = viajesConTiempo > 0 ? Math.round(minutosAcumulados / viajesConTiempo) : 0;

      this.flotaVehiculos = Array.from(placasMap.entries()).map(([placa, info]) => ({
        placa,
        total_viajes: info.total,
        viajes_entregados: info.entregados,
        viajes_en_ruta: info.enRuta,
        ultimo_viaje: info.ultimo || 'Reciente'
      })).sort((a, b) => b.total_viajes - a.total_viajes);

      this.desempenoChoferes = Array.from(choferesMap.entries()).map(([chofer, info]) => ({
        chofer,
        total_viajes: info.total,
        viajes_entregados: info.entregados,
        tasa_cumplimiento: info.total > 0 ? Math.round((info.entregados / info.total) * 100) : 100,
        promedio_minutos: info.countTiempos > 0 ? Math.round(info.minutosTotales / info.countTiempos) : 0
      })).sort((a, b) => b.total_viajes - a.total_viajes);

    } catch (e) {
      console.error('Error cargando analítica de logística:', e);
    } finally {
      this.loadingLogistica = false;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // PESTAÑA 5: INVENTARIO Y ROTACIÓN DE MATERIALES
  // ══════════════════════════════════════════════════════════════════

  async cargarInventario() {
    this.loadingInventario = true;
    try {
      const { data, error } = await this.supabase
        .from('productos')
        .select('*')
        .order('descripcion', { ascending: true });

      if (error) throw error;

      let valorTotal = 0;
      let bajoMinimo = 0;

      this.inventario = (data || []).map(p => {
        const stockActual = Number(p.stock_actual) || 0;
        const precioBase = Number(p.precio_unitario_base) || 0;
        const stockMin = Number(p.stock_minimo) || 0;
        const valInmovilizado = stockActual * precioBase;

        valorTotal += valInmovilizado;
        if (stockActual <= stockMin) bajoMinimo++;

        return {
          ...p,
          stock_actual: stockActual,
          stock_minimo: stockMin,
          precio_unitario_base: precioBase,
          valor_inmovilizado: valInmovilizado
        };
      });

      this.totalValorizadoInventario = valorTotal;
      this.productosBajoMinimoCount = bajoMinimo;

      await this.cargarTopProductos();

    } catch (e) {
      console.error('Error cargando inventario:', e);
    } finally {
      this.loadingInventario = false;
    }
  }

  private async cargarTopProductos() {
    try {
      const { data: items } = await this.supabase
        .from('pedidos_items')
        .select(`
          cantidad,
          subtotal,
          descripcion_manual,
          unidad_medida_manual,
          pedidos!inner ( estado, tipo_documento )
        `)
        .eq('pedidos.tipo_documento', 'ORDEN_VENTA')
        .neq('pedidos.estado', 'ANULADA');

      const prodMap = new Map<string, { desc: string; um: string; cantidad: number; total: number }>();

      (items || []).forEach((it: any) => {
        const desc = (it.descripcion_manual || 'Material').trim();
        const um = (it.unidad_medida_manual || 'UND').trim();
        const key = `${desc}__${um}`;
        const cur = prodMap.get(key) || { desc, um, cantidad: 0, total: 0 };
        cur.cantidad += Number(it.cantidad) || 0;
        cur.total += Number(it.subtotal) || 0;
        prodMap.set(key, cur);
      });

      this.topProductosVendidos = Array.from(prodMap.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 8);

    } catch (e) {
      console.error('Error cargando top productos:', e);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // HELPERS UI Y EXPORTACIÓN EXCEL/CSV
  // ══════════════════════════════════════════════════════════════════

  getSeverity(estado: string): 'success' | 'secondary' | 'info' | 'warning' | 'danger' | 'contrast' | undefined {
    switch (estado) {
      case 'APROBADA': return 'success';
      case 'COMPLETADA': return 'info';
      case 'ANULADA': return 'danger';
      case 'COTIZACION': return 'warning';
      default: return undefined;
    }
  }

  getSeverityMora(mora: string): 'success' | 'warning' | 'danger' {
    switch (mora) {
      case 'VENCIDO': return 'danger';
      case 'POR_VENCER': return 'warning';
      case 'VIGENTE': return 'success';
      default: return 'success';
    }
  }

  exportExcel(tipo: 'ventas' | 'deudas' | 'logistica' | 'inventario') {
    const configs: Record<string, { filename: string; columns: any[]; rows: any[] }> = {
      ventas: { filename: 'Reporte_Ventas_y_Finanzas', columns: this.colsVentas, rows: this.ventas },
      deudas: { filename: 'Reporte_Cuentas_por_Cobrar_Aging', columns: this.colsDeudas, rows: this.deudas },
      logistica: { filename: 'Reporte_Logistica_y_Flota', columns: this.colsLogistica, rows: this.flotaVehiculos },
      inventario: { filename: 'Reporte_Valorizacion_Inventario', columns: this.colsInventario, rows: this.inventario }
    };
    const cfg = configs[tipo];
    if (!cfg || cfg.rows.length === 0) {
      alert('No hay datos disponibles para exportar en este reporte.');
      return;
    }
    this.descargarCsv(cfg.filename, cfg.columns, cfg.rows);
  }

  private descargarCsv(filename: string, columns: { field: string; header: string }[], rows: any[]) {
    const escapar = (valor: any) => {
      const texto = valor === null || valor === undefined ? '' : String(valor);
      return '"' + texto.replace(/"/g, '""') + '"';
    };
    const encabezado = columns.map(c => escapar(c.header)).join(';');
    const lineas = rows.map(row => columns.map(c => escapar(row[c.field])).join(';'));
    const csv = '\uFEFF' + [encabezado, ...lineas].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  private fmtCompacto(num: number): string {
    if (Math.abs(num) >= 1000000) return (num / 1000000).toFixed(1).replace('.0', '') + 'M';
    if (Math.abs(num) >= 1000) return (num / 1000).toFixed(1).replace('.0', '') + 'k';
    return num.toLocaleString('es-PE');
  }
}
