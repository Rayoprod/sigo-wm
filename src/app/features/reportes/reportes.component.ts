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
    ChipModule
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
    { label: 'Cotización', value: 'COTIZACION' }
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
    { field: 'total', header: 'Total' },
    { field: 'saldo_pendiente', header: 'Deuda Pendiente' }
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
        fromDate.setHours(0, 0, 0, 0);
        query = query.gte('created_at', fromDate.toISOString());
      }
      
      if (this.fechaFinVentas) {
        const toDate = new Date(this.fechaFinVentas);
        toDate.setHours(23, 59, 59, 999);
        query = query.lte('created_at', toDate.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      
      this.ventas = data.map(v => {
        const pagos = (v.pagos as any[]) || [];
        const pagado = pagos.reduce((sum: number, p: any) => sum + Number(p.monto_pagado), 0);
        const saldo  = Number(v.total) - pagado;
        const metodos = [...new Set(pagos.map((p: any) => p.metodo_pago).filter(Boolean))].join(', ');
        const dDate  = new Date(v.created_at);
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
          fecha_formateada:  dDate.toLocaleDateString('es-PE') + ' ' + dDate.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }),
          cliente_nombre:    (v.clientes as any)?.nombre_razon_social  || 'Consumidor Final',
          cliente_doc:       (v.clientes as any)?.documento_identidad   || '',
          cliente_telefono:  (v.clientes as any)?.telefono              || '',
          tipo_entrega_label: tipoEntregaMap[(v as any).tipo_entrega]   || (v as any).tipo_entrega || '',
          direccion_entrega: direccionEntrega,
          metodo_pago:       metodos || 'Sin registro',
          subtotal:          Number((v as any).subtotal)         || 0,
          descuento_global:  Number((v as any).descuento_global) || 0,
          igv:               Number((v as any).igv)              || 0,
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
          estado,
          clientes ( nombre_razon_social, telefono ),
          pagos ( monto_pagado )
        `)
        .neq('estado', 'ANULADA')
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      this.deudas = data.map(d => {
        const pagado = d.pagos?.reduce((sum: number, p: any) => sum + Number(p.monto_pagado), 0) || 0;
        const saldo = Number(d.total) - pagado;
        const dDate = new Date(d.created_at);
        return {
          ...d,
          saldo_pendiente: saldo,
          fecha_formateada: dDate.toLocaleDateString(),
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

  exportExcel(dt: any) {
    // PrimeNG exportCSV is good enough to be opened in Excel, 
    // it will just prompt a download as .csv
    dt.exportCSV();
  }

}
