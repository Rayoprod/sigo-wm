import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AuthService } from '../../../core/services/auth.service';

import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { InputTextModule } from 'primeng/inputtext';
import { DropdownModule } from 'primeng/dropdown';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';

import { PdfService } from '../../../core/services/pdf.service';
import { InventarioService } from '../../../core/services/inventario.service';

@Component({
  selector: 'app-comercial-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    TableModule,
    ButtonModule,
    TagModule,
    InputTextModule,
    DropdownModule,
    ConfirmDialogModule,
    FormsModule,
    DialogModule,
    InputNumberModule,
    CardModule
  ],
  providers: [ConfirmationService],
  templateUrl: './comercial-list.component.html',
  styleUrl: './comercial-list.component.scss'
})
export class ComercialListComponent implements OnInit {
  supabase = inject(SupabaseService).client;
  pdfService = inject(PdfService);
  confirmationService = inject(ConfirmationService);
  inventarioService = inject(InventarioService);
  authService = inject(AuthService);

  pedidos: any[] = [];
  loading = true;
  isGeneratingPdf = false;

  estadosCotizacion = [
    { label: 'Pendiente', value: 'PENDIENTE' },
    { label: 'Aprobada (Convertir a Venta)', value: 'APROBADA' },
    { label: 'Rechazada', value: 'RECHAZADA' }
  ];

  estadosVenta = [
    { label: 'Aprobada', value: 'APROBADA' },
    { label: 'Completada', value: 'COMPLETADA' },
    { label: 'Anulada', value: 'ANULADA' }
  ];

  // Variables para Dialog de Conversión
  displayConversionDialog = false;
  pedidoAConvertir: any = null;
  nuevoEstadoConversion = '';
  tipoNuevoConversion = '';
  wasDeductedConversion = false;
  willBeDeductedConversion = false;

  conversionConfig = {
    estadoPago: 'PENDIENTE',
    diasCredito: 0
  };

  opcionesPago = [
    { label: 'Pendiente (Crédito Total)', value: 'PENDIENTE' },
    { label: 'Crédito Parcial', value: 'PARCIAL' },
    { label: 'Pagado Completo', value: 'PAGADO' }
  ];

  // Variables de Gestión de Pagos
  displayPagosModal = false;
  selectedPedidoPagos: any = null;
  historialPagos: any[] = [];
  saldoDeudor = 0;
  nuevoPago = {
    monto: 0,
    metodo: 'EFECTIVO',
    referencia: ''
  };
  metodosPago = [
    { label: 'Efectivo', value: 'EFECTIVO' },
    { label: 'Transferencia BCP', value: 'TRANSFERENCIA_BCP' },
    { label: 'Yape / Plin', value: 'BILLETERA_DIGITAL' },
    { label: 'Tarjeta (POS)', value: 'TARJETA' },
    { label: 'Cheque', value: 'CHEQUE' },
    { label: 'Otro', value: 'OTRO' }
  ];
  isSavingPago = false;

  async ngOnInit() {
    await this.loadPedidos();
  }

  async loadPedidos() {
    this.loading = true;
    const { data, error } = await this.supabase
      .from('pedidos')
      .select('*, clientes(nombre_razon_social), pagos(monto_pagado)')
      .order('created_at', { ascending: false });
      
    if (error) {
      console.error('Error loading pedidos', error);
    } else {
      this.pedidos = data || [];
    }
    this.loading = false;
  }

  getSeverityEstado(estado: string): 'success' | 'info' | 'warning' | 'danger' | 'secondary' {
    switch(estado) {
      case 'PENDIENTE': return 'warning';
      case 'APROBADA': return 'info';
      case 'COMPLETADA': return 'success';
      case 'ANULADA': return 'danger';
      default: return 'secondary';
    }
  }

  isCotizacionVencida(pedido: any): boolean {
    if (pedido.tipo_documento !== 'COTIZACION') return false;
    if (pedido.estado !== 'PENDIENTE') return false;
    
    if (!pedido.created_at || !pedido.dias_validez_oferta) return false;
    
    const createdAt = new Date(pedido.created_at);
    const validUntil = new Date(createdAt);
    validUntil.setDate(validUntil.getDate() + pedido.dias_validez_oferta);
    
    const today = new Date();
    return today > validUntil;
  }

  async generarPDF(pedido: any) {
    if (this.isGeneratingPdf) return;
    this.isGeneratingPdf = true;
    
    // Mostramos un alert simple temporalmente para asegurar que el botón funciona
    // ya que el usuario reporta que no hace "absolutamente nada"
    try {
      console.log('Iniciando generación de PDF para pedido', pedido.id);
      await this.pdfService.generateComercialPdf(pedido.id);
      console.log('PDF generado exitosamente');
    } catch (e: any) {
      console.error('Error capturado en el componente:', e);
      alert('Error al generar PDF: ' + (e.message || JSON.stringify(e)));
    } finally {
      this.isGeneratingPdf = false;
    }
  }

  compartirWhatsApp(pedido: any) {
    const trackingUrl = `https://sigo-wm.vercel.app/rastreo/${pedido.tracking_token || pedido.folio}`;
    const text = `Hola, somos W&M. Tu pedido ${pedido.folio} está en curso. Sigue la ruta en vivo aquí: ${trackingUrl}`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  }

  onEstadoChange(event: any, pedido: any) {
    const nuevoEstado = event.value;
    const estadoOriginal = pedido.estado;
    const tipoOriginal = pedido.tipo_documento;

    let tipoNuevo = tipoOriginal;
    if (tipoOriginal === 'COTIZACION' && nuevoEstado === 'APROBADA') {
      tipoNuevo = 'ORDEN_VENTA';
    }

    const wasDeducted = tipoOriginal === 'ORDEN_VENTA' && (estadoOriginal === 'APROBADA' || estadoOriginal === 'COMPLETADA');
    const willBeDeducted = tipoNuevo === 'ORDEN_VENTA' && (nuevoEstado === 'APROBADA' || nuevoEstado === 'COMPLETADA');

    if (tipoOriginal === 'COTIZACION' && nuevoEstado === 'APROBADA') {
      this.pedidoAConvertir = pedido;
      this.nuevoEstadoConversion = nuevoEstado;
      this.tipoNuevoConversion = tipoNuevo;
      this.wasDeductedConversion = wasDeducted;
      this.willBeDeductedConversion = willBeDeducted;
      
      this.conversionConfig = {
        estadoPago: 'PENDIENTE',
        diasCredito: 0
      };
      
      this.displayConversionDialog = true;
    } else {
      // Otros cambios de estado
      this.actualizarEstadoYStock(pedido, nuevoEstado, tipoNuevo, wasDeducted, willBeDeducted);
    }
  }

  async confirmarConversion() {
    this.displayConversionDialog = false;
    await this.actualizarEstadoYStock(
      this.pedidoAConvertir,
      this.nuevoEstadoConversion,
      this.tipoNuevoConversion,
      this.wasDeductedConversion,
      this.willBeDeductedConversion,
      this.conversionConfig.estadoPago,
      this.conversionConfig.diasCredito
    );

    // Al convertir a Venta con pago inmediato, registrar el comprobante en `pagos`.
    // Antes, solo se actualizaba el campo estado_pago del pedido sin crear la fila
    // en pagos. Con el trigger fn_sincronizar_pago_pedido esto revertía el estado
    // a PENDIENTE porque SUM(pagos) era 0.
    const ep = this.conversionConfig.estadoPago;
    if ((ep === 'PAGADO' || ep === 'PARCIAL') && this.pedidoAConvertir) {
      const total = Number(this.pedidoAConvertir.total) || 0;
      const montoPago = ep === 'PAGADO' ? total : 0; // PARCIAL sin monto definido: 0 por ahora
      if (montoPago > 0) {
        const usuario = this.authService.currentUser();
        await this.supabase
          .from('pagos')
          .insert({
            pedido_id: this.pedidoAConvertir.id,
            monto_pagado: montoPago,
            metodo_pago: 'EFECTIVO', // default; el usuario puede editarlo desde el modal de pagos
            referencia_operacion: 'Pago registrado al convertir cotización',
            usuario_id: usuario?.id
          });
      }
    }
  }

  cancelarConversion() {
    this.displayConversionDialog = false;
    this.loadPedidos(); // Revert dropdown
  }

  async actualizarEstadoYStock(pedido: any, nuevoEstado: string, tipoNuevo: string, wasDeducted: boolean, willBeDeducted: boolean, estadoPagoForzado?: string, diasCredito?: number) {
     try {
         // 1. Manejo de inventario
         if (wasDeducted && !willBeDeducted) {
             await this.inventarioService.reponerStockPorVenta(pedido.id, pedido.folio, 'Cambio de Estado');
         } else if (!wasDeducted && willBeDeducted) {
             await this.inventarioService.descontarStockPorVenta(pedido.id, pedido.folio);
         }
         
         // 2. Manejo de Finanzas y Logística al Anular
         let estadoPagoFinal = pedido.estado_pago;
         if (nuevoEstado === 'ANULADA') {
            // Eliminar despachos pendientes
            await this.supabase.from('despachos_viajes_cabecera').delete().eq('pedido_id', pedido.id);
            // Eliminar pagos asociados
            await this.supabase.from('pagos').delete().eq('pedido_id', pedido.id);
            estadoPagoFinal = 'PENDIENTE';
         }

         // 3. Update DB
         let fechaVencimiento: Date | null = null;
         let finalDiasCredito = 0;

         if (estadoPagoForzado) {
             estadoPagoFinal = estadoPagoForzado;
             if (estadoPagoFinal !== 'PAGADO' && diasCredito) {
                 finalDiasCredito = diasCredito;
                 fechaVencimiento = new Date();
                 fechaVencimiento.setDate(fechaVencimiento.getDate() + diasCredito);
             }
         }

         await this.actualizarEstado(pedido.id, nuevoEstado, tipoNuevo, estadoPagoFinal, finalDiasCredito, fechaVencimiento);
         
         // 4. Update view model
         const tipoOriginal = pedido.tipo_documento;
         pedido.estado = nuevoEstado;
         pedido.tipo_documento = tipoNuevo;
         pedido.estado_pago = estadoPagoFinal;
         if (tipoNuevo === 'ORDEN_VENTA' && tipoOriginal === 'COTIZACION' && !estadoPagoForzado) {
             pedido.estado_pago = 'PENDIENTE';
         }
     } catch (e: any) {
         alert('Error procesando el cambio de estado: ' + e.message);
         this.loadPedidos();
     }
  }

  async actualizarEstado(id: string, estado: string, tipo_documento: string, estado_pago: string, dias_credito?: number, fecha_vencimiento?: Date | null) {
    const payload: any = { estado, tipo_documento, estado_pago };
    
    if (dias_credito !== undefined) {
      payload.dias_credito = dias_credito;
    }
    if (fecha_vencimiento !== undefined) {
      payload.fecha_vencimiento = fecha_vencimiento ? fecha_vencimiento.toISOString().split('T')[0] : null;
    }

    const { error } = await this.supabase
      .from('pedidos')
      .update(payload)
      .eq('id', id);
    if (error) throw error;
  }

  // --- Lógica de Gestión de Pagos ---
  
  calcularSaldoDeudor(pedido: any) {
    if (!pedido) return 0;
    const totalPagado = (pedido.pagos || []).reduce((acc: number, p: any) => acc + Number(p.monto_pagado), 0);
    return Number(pedido.total) - totalPagado;
  }

  async openCobro(pedido: any) {
    this.selectedPedidoPagos = pedido;
    
    const { data: pagos, error } = await this.supabase
      .from('pagos')
      .select('*, usuarios(nombre_completo)')
      .eq('pedido_id', pedido.id)
      .order('fecha_pago', { ascending: true });

    if (error) {
      console.error('Error al obtener historial de pagos:', error);
    }
    
    this.historialPagos = pagos || [];
    const totalPagado = this.historialPagos.reduce((acc, p) => acc + Number(p.monto_pagado), 0);
    this.saldoDeudor = Number(pedido.total) - totalPagado;

    this.nuevoPago = {
      monto: this.saldoDeudor > 0 ? this.saldoDeudor : 0,
      metodo: 'EFECTIVO',
      referencia: ''
    };

    this.displayPagosModal = true;
  }

  async registrarAbono() {
    if (this.nuevoPago.monto <= 0 || this.nuevoPago.monto > this.saldoDeudor) {
      alert('El monto a pagar debe ser mayor a 0 y no puede exceder el saldo deudor pendiente (' + this.saldoDeudor + ').');
      return;
    }

    const usuarioActual = this.authService.currentUser();
    if (!usuarioActual) {
      alert('Error: No se pudo identificar al usuario actual.');
      return;
    }

    this.isSavingPago = true;
    try {
      // 1. Insertar el pago en DB
      const { error: errPago } = await this.supabase
        .from('pagos')
        .insert({
          pedido_id: this.selectedPedidoPagos.id,
          monto_pagado: this.nuevoPago.monto,
          metodo_pago: this.nuevoPago.metodo,
          referencia_operacion: this.nuevoPago.referencia,
          usuario_id: usuarioActual.id
        });

      if (errPago) throw errPago;

      // 2. Calcular nuevo saldo para actualizar estado de pago del pedido
      const nuevoTotalPagado = this.historialPagos.reduce((acc, p) => acc + Number(p.monto_pagado), 0) + this.nuevoPago.monto;
      const nuevoSaldo = Number(this.selectedPedidoPagos.total) - nuevoTotalPagado;
      let nuevoEstadoPago = 'PARCIAL';
      
      if (nuevoSaldo <= 0) {
        nuevoEstadoPago = 'PAGADO';
      }

      // 3. Actualizar estado del pedido en DB
      const { error: errPedido } = await this.supabase
        .from('pedidos')
        .update({ estado_pago: nuevoEstadoPago })
        .eq('id', this.selectedPedidoPagos.id);

      if (errPedido) throw errPedido;

      // 4. Refrescar datos locales
      this.selectedPedidoPagos.estado_pago = nuevoEstadoPago;
      
      // Actualizar la referencia en la tabla
      const idx = this.pedidos.findIndex(p => p.id === this.selectedPedidoPagos.id);
      if (idx !== -1) {
        if (!this.pedidos[idx].pagos) this.pedidos[idx].pagos = [];
        this.pedidos[idx].pagos.push({ monto_pagado: this.nuevoPago.monto });
        this.pedidos[idx].estado_pago = nuevoEstadoPago;
      }

      // Recargar modal
      await this.openCobro(this.selectedPedidoPagos);
    } catch (e: any) {
      alert('Error registrando el pago: ' + e.message);
    } finally {
      this.isSavingPago = false;
    }
  }
}
