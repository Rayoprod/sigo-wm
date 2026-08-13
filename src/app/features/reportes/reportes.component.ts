import { Component, OnInit } from '@angular/core';
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
import { SupabaseService } from '../../core/services/supabase.service';
import { environment } from '../../../environments/environment';
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
    PeruDatePipe
  ],
  templateUrl: './reportes.component.html',
  styleUrl: './reportes.component.scss'
})
export class ReportesComponent implements OnInit {
  
  loadingVentas = false;
  loadingDeudas = false;
  loadingInventario = false;

  // Datos
  ventas: any[] = [];
  deudas: any[] = [];
  inventario: any[] = [];

  // Filtros Ventas
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


  constructor(private supabase: SupabaseService) {}

  // Columnas para Exportación
  colsVentas = [
    { field: 'fecha_formateada',      header: 'Fecha' },
    { field: 'folio',                 header: 'Folio' },
    { field: 'tipo_documento',        header: 'Tipo Doc.' },
    { field: 'cliente_nombre',        header: 'Cliente' },
    { field: 'cliente_doc',           header: 'Doc. Cliente' },
    { field: 'cliente_telefono',      header: 'Teléfono Cliente' },
    { field: 'tipo_entrega_label',    header: 'Tipo Entrega' },
    { field: 'direccion_entrega',     header: 'Dirección Entrega' },
    { field: 'subtotal',              header: 'Subtotal (S/)' },
    { field: 'descuento_global',      header: 'Descuento (S/)' },
    { field: 'igv',                   header: 'IGV (S/)' },
    { field: 'total',                 header: 'Total (S/)' },
    { field: 'total_pagado',          header: 'Total Pagado (S/)' },
    { field: 'saldo_pendiente',       header: 'Saldo Pendiente (S/)' },
    { field: 'metodo_pago',           header: 'Método Pago' },
    { field: 'folio_cotizacion_origen', header: 'Folio Cot. Origen' },
    { field: 'estado_pago',           header: 'Estado Pago' },
    { field: 'estado',                header: 'Estado Doc.' },
  ];

  colsDeudas = [
    { field: 'fecha_formateada', header: 'Fecha' },
    { field: 'folio', header: 'Folio' },
    { field: 'cliente_nombre', header: 'Cliente' },
    { field: 'cliente_telefono', header: 'Teléfono' },
    { field: 'total', header: 'Total (S/)' },
    { field: 'total_pagado', header: 'Abonado (S/)' },
    { field: 'saldo_pendiente', header: 'Deuda Pendiente (S/)' },
    { field: 'estado_pago', header: 'Estado Pago' }
  ];

  colsInventario = [
    { field: 'descripcion', header: 'Producto' },
    { field: 'unidad_medida', header: 'Unidad' },
    { field: 'stock_actual', header: 'Stock Físico' },
    { field: 'precio_unitario_base', header: 'Precio Base' },
    { field: 'valor_inmovilizado', header: 'Valor Inmovilizado' }
  ];

  ngOnInit() {
    this.cargarVentas();
    this.cargarDeudas();
    this.cargarInventario();
  }

  // REPORTE A: Historial de Ventas
  async cargarVentas() {
    this.loadingVentas = true;
    try {
      let query = this.supabase.client
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

      // Filtro de Estado
      if (this.estadoVentaFiltro) {
        query = query.eq('estado', this.estadoVentaFiltro);
      }

      // Filtro de Fechas
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
      
      this.ventas = data.map(v => {
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
          CANTERA:   'Recojo en Cantera'
        };
        const direccionEntrega = (v as any).lugar_entrega === 'OBRA'
          ? ((v as any).direccion_entrega_detalle || 'Sin detalle')
          : 'Recojo en Cantera';
        return {
          ...v,
          saldo_pendiente:   saldo,
          total_pagado:      pagado,
          fecha_formateada:  isFechaValid ? (dDate.toLocaleDateString('es-PE') + ' ' + dDate.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })) : 'N/A',
          cliente_nombre:    (v.clientes as any)?.nombre_razon_social  || 'Consumidor Final',
          cliente_doc:       (v.clientes as any)?.documento_identidad   || '',
          cliente_telefono:  (v.clientes as any)?.telefono              || '',
          tipo_entrega_label: tipoEntregaMap[(v as any).tipo_entrega]   || (v as any).tipo_entrega || '',
          direccion_entrega: direccionEntrega,
          metodo_pago:       metodos || 'Sin registro',
          subtotal:          Number((v as any).subtotal)         || 0,
          descuento_global:  Number((v as any).descuento_global) || 0,
          igv:               Number((v as any).igv)              || 0,
          precios_con_igv:   (v as any).precios_con_igv === true,
        };
      });
    } catch (e) {
      console.error(e);
    } finally {
      this.loadingVentas = false;
    }
  }

  aplicarFiltrosVentas() {
    this.cargarVentas();
  }

  // REPORTE B: Cuentas por Cobrar (Deudas)
  async cargarDeudas() {
    this.loadingDeudas = true;
    try {
      const { data, error } = await this.supabase.client
        .from('pedidos')
        .select(`
          id,
          folio,
          created_at,
          total,
          monto_pagado,
          estado_pago,
          estado,
          clientes ( nombre_razon_social, telefono ),
          pagos ( monto_pagado )
        `)
        .eq('tipo_documento', 'ORDEN_VENTA')
        .neq('estado', 'COTIZACION')
        .neq('estado', 'ANULADA')
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      this.deudas = data.map(d => {
        const pagadoFromPayments = d.pagos?.reduce((sum: number, p: any) => sum + Number(p.monto_pagado), 0) || 0;
        const totalPagado = d.monto_pagado !== null && d.monto_pagado !== undefined ? Number(d.monto_pagado) : pagadoFromPayments;
        const rawSaldo = Number(d.total) - totalPagado;
        const saldo = Math.round(rawSaldo * 100) / 100;
        const safeDateStr = typeof d.created_at === 'string' ? d.created_at.replace(' ', 'T') : d.created_at;
        const dDate = safeDateStr ? new Date(safeDateStr) : new Date();
        const isFechaValid = !isNaN(dDate.getTime());
        return {
          ...d,
          total_pagado: totalPagado,
          saldo_pendiente: saldo,
          fecha_formateada: isFechaValid ? dDate.toLocaleDateString('es-PE') : 'N/A',
          cliente_nombre: (d.clientes as any)?.nombre_razon_social || 'Consumidor Final',
          cliente_telefono: (d.clientes as any)?.telefono || '-'
        };
      }).filter(d => d.saldo_pendiente > 0);
    } catch (e) {
      console.error(e);
    } finally {
      this.loadingDeudas = false;
    }
  }

  // REPORTE C: Valorización de Inventario
  async cargarInventario() {
    this.loadingInventario = true;
    try {
      const { data, error } = await this.supabase.client
        .from('productos')
        .select('*')
        .order('descripcion', { ascending: true });

      if (error) throw error;

      this.inventario = data.map(p => {
        const stockActual = Number(p.stock_actual) || 0;
        const precioBase = Number(p.precio_unitario_base) || 0;
        return {
          ...p,
          valor_inmovilizado: stockActual * precioBase
        };
      });
    } catch (e) {
      console.error(e);
    } finally {
      this.loadingInventario = false;
    }
  }

  // Helpers UI
  getSeverity(estado: string): 'success' | 'secondary' | 'info' | 'warning' | 'danger' | 'contrast' | undefined {
    switch(estado) {
      case 'APROBADA': return 'success';
      case 'COMPLETADA': return 'info';
      case 'ANULADA': return 'danger';
      case 'COTIZACION': return 'warning';
      default: return undefined;
    }
  }

  exportExcel(tipo: 'ventas' | 'deudas' | 'inventario') {
    const configs: Record<string, { filename: string; columns: any[]; rows: any[] }> = {
      ventas:     { filename: 'Reporte_Ventas',               columns: this.colsVentas,     rows: this.ventas },
      deudas:     { filename: 'Reporte_Cuentas_por_Cobrar',   columns: this.colsDeudas,     rows: this.deudas },
      inventario: { filename: 'Reporte_Valorizacion_Inventario', columns: this.colsInventario, rows: this.inventario }
    };
    const cfg = configs[tipo];
    if (!cfg || cfg.rows.length === 0) {
      alert('No hay datos para exportar en este reporte.');
      return;
    }
    this.descargarCsv(cfg.filename, cfg.columns, cfg.rows);
  }

  // Genera y descarga un CSV compatible con Excel (UTF-8 con BOM y ';' como separador).
  private descargarCsv(filename: string, columns: { field: string; header: string }[], rows: any[]) {
    const escapar = (valor: any) => {
      const texto = valor === null || valor === undefined ? '' : String(valor);
      return '"' + texto.replace(/"/g, '""') + '"';
    };
    const encabezado = columns.map(c => escapar(c.header)).join(';');
    const lineas = rows.map(row => columns.map(c => escapar(row[c.field])).join(';'));
    // BOM UTF-8 para que Excel reconozca caracteres especiales (ó, ñ, S/)
    const csv = '\uFEFF' + [encabezado, ...lineas].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

}
