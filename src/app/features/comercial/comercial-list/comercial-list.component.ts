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
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { TooltipModule } from 'primeng/tooltip';
import { InputNumberModule } from 'primeng/inputnumber';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';

import * as L from 'leaflet';

import { PdfService } from '../../../core/services/pdf.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { PeruDatePipe } from '../../../shared/pipes/peru-date.pipe';

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
    CardModule,
    TooltipModule,
    PeruDatePipe
  ],
  providers: [ConfirmationService, MessageService],
  templateUrl: './comercial-list.component.html',
  styleUrl: './comercial-list.component.scss'
})
export class ComercialListComponent implements OnInit {
  private supabase = inject(SupabaseService).client;
  private authService = inject(AuthService);
  private pdfService = inject(PdfService);
  private inventarioService = inject(InventarioService);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);

  pedidos: any[] = [];
  loading = true;
  generatingPdfId: string | null = null;

  private conversionMap: L.Map | null = null;
  private conversionMarker: L.Marker | null = null;

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

  // Variables para Dialog 
  onConversionDialogShow() {
    setTimeout(() => this.initConversionMap(), 200);
  }

  onConversionDialogHide() {
    this.destroyConversionMap();
  }

  closeConversionDialog() {
    this.destroyConversionMap();
    this.displayConversionDialog = false;
    this.pedidoAConvertir = null;
    this.nuevoEstadoConversion = '';
    this.tipoNuevoConversion = '';
  }

  private initConversionMap(): void {
    const container = document.getElementById('mapa-seleccion-destino');
    if (!container) return;
    this.destroyConversionMap();

    const hasCoords = this.conversionConfig.lat_destino != null && this.conversionConfig.lng_destino != null;
    const lat = hasCoords ? Number(this.conversionConfig.lat_destino) : -12.046374;
    const lng = hasCoords ? Number(this.conversionConfig.lng_destino) : -77.042793;

    this.conversionMap = L.map(container, { maxZoom: 19, attributionControl: false }).setView([lat, lng], hasCoords ? 16 : 12);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(this.conversionMap);

    if (hasCoords) {
      this.setConversionMarker(lat, lng);
    }

    this.conversionMap.on('click', (e: L.LeafletMouseEvent) => {
      const newLat = e.latlng.lat;
      const newLng = e.latlng.lng;
      this.conversionConfig.lat_destino = newLat;
      this.conversionConfig.lng_destino = newLng;
      this.setConversionMarker(newLat, newLng);
    });

    setTimeout(() => this.conversionMap?.invalidateSize(), 150);
    setTimeout(() => this.conversionMap?.invalidateSize(), 400);
  }

  private setConversionMarker(lat: number, lng: number): void {
    if (!this.conversionMap) return;
    if (this.conversionMarker) {
      this.conversionMarker.setLatLng([lat, lng]);
    } else {
      const icon = L.icon({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      });
      this.conversionMarker = L.marker([lat, lng], { icon }).addTo(this.conversionMap);
    }
  }

  private destroyConversionMap(): void {
    if (this.conversionMap) {
      try { this.conversionMap.remove(); } catch (e) {}
      this.conversionMap = null;
      this.conversionMarker = null;
    }
  }

  centrarEnMiUbicacion() {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          this.conversionConfig.lat_destino = lat;
          this.conversionConfig.lng_destino = lng;
          if (this.conversionMap) {
            this.conversionMap.setView([lat, lng], 16);
            this.setConversionMarker(lat, lng);
          }
        },
        (err) => {
          console.warn('Geolocation error:', err);
        }
      );
    }
  }

  limpiarPuntoDestino() {
    this.conversionConfig.lat_destino = null;
    this.conversionConfig.lng_destino = null;
    if (this.conversionMarker) {
      this.conversionMarker.remove();
      this.conversionMarker = null;
    }
  }

  displayConversionDialog = false;
  pedidoAConvertir: any = null;
  nuevoEstadoConversion = '';
  tipoNuevoConversion = '';
  wasDeductedConversion = false;
  willBeDeductedConversion = false;

  conversionConfig = {
    estadoPago: 'PENDIENTE',
    diasCredito: 0,
    montoAdelanto: 0,
    metodoPago: 'EFECTIVO',
    referencia: '',
    lat_destino: null as number | null,
    lng_destino: null as number | null
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
    { label: 'Transferencia', value: 'TRANSFERENCIA' },
    { label: 'Yape / Plin', value: 'BILLETERA_DIGITAL' },
  ];
  isSavingPago = false;

  async deleteStorageFolderRecursively(path: string) {
    const { data: items, error } = await this.supabase.storage.from('assets').list(path);
    if (error || !items || items.length === 0) return;
    
    let toDelete: string[] = [];
    for (const item of items) {
      const itemPath = `${path}/${item.name}`;
      if (item.id !== null || item.name === '.emptyFolderPlaceholder') {
        toDelete.push(itemPath);
      } else {
        // Es subcarpeta, entrar recursivamente
        await this.deleteStorageFolderRecursively(itemPath);
        toDelete.push(itemPath); // Borrar la carpeta en sí
      }
    }
    
    // Borrar en lotes de 50
    const chunk = 50;
    for (let i = 0; i < toDelete.length; i += chunk) {
      const slice = toDelete.slice(i, i + chunk);
      await this.supabase.storage.from('assets').remove(slice);
    }
  }

  async eliminarPedidoPruebas(pedido: any) {
    this.confirmationService.confirm({
      message: `¡ATENCIÓN! Esta acción borrará el pedido ${pedido.folio}, TODOS sus viajes, historial GPS, pagos, y borrará las fotos de la nube de forma recursiva. Es un borrado irreversible.<br><br>¿Estás completamente seguro de borrarlo?`,
      header: 'Eliminar Pedido (Modo Pruebas)',
      icon: 'pi pi-exclamation-triangle text-red-500',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-text',
      acceptLabel: 'Sí, Borrar Todo',
      rejectLabel: 'Cancelar',
      accept: async () => {
        try {
          // 1. Borrar fotos del bucket (recursivamente)
          const folderPath = `evidencias/pedidos/${pedido.folio}`;
          await this.deleteStorageFolderRecursively(folderPath);
          
          // 2. Ejecutar RPC de borrado en cascada
          const { error: rpcError } = await this.supabase.rpc('delete_pedido_cascade', { p_pedido_id: pedido.id });
          if (rpcError) throw rpcError;
          
          this.messageService.add({ severity: 'success', summary: 'Borrado Exitoso', detail: `El pedido ${pedido.folio} y todas sus dependencias y fotos fueron eliminados.` });
          this.loadPedidos();
        } catch (error: any) {
          console.error(error);
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'No se pudo eliminar el pedido: ' + error.message });
        }
      }
    });
  }

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
      case 'RECHAZADA': return 'danger';
      case 'ANULADA': return 'danger';
      default: return 'secondary';
    }
  }

  isCotizacionVencida(pedido: any): boolean {
    if (pedido.tipo_documento !== 'COTIZACION') return false;
    if (pedido.estado !== 'PENDIENTE') return false;
    
    const safeStr = typeof pedido.created_at === 'string' ? pedido.created_at.replace(' ', 'T') : pedido.created_at;
    const createdAt = new Date(safeStr);
    if (isNaN(createdAt.getTime())) return false;
    const validUntil = new Date(createdAt);
    validUntil.setDate(validUntil.getDate() + pedido.dias_validez_oferta);
    
    const today = new Date();
    return today > validUntil;
  }

  // Botones explícitos Aprobar / Rechazar para cotizaciones pendientes.
  // (Además del dropdown de estado, para que la acción sea visible.)
  aprobarCotizacion(pedido: any) {
    if (this.isCotizacionVencida(pedido)) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Cotización vencida',
        detail: 'Esta cotización superó su validez. Edítala para renovar la fecha o regístrala nuevamente.'
      });
      return;
    }
    // Reutiliza el flujo existente de conversión a Orden de Venta.
    this.onEstadoChange({ value: 'APROBADA' }, pedido);
  }

  rechazarCotizacion(pedido: any) {
    this.confirmationService.confirm({
      message: `¿Estás seguro de rechazar la cotización <b>${pedido.folio}</b>?`,
      header: 'Rechazar Cotización',
      icon: 'pi pi-times-circle text-red-500',
      acceptLabel: 'Sí, Rechazar',
      rejectLabel: 'Cancelar',
      acceptButtonStyleClass: 'p-button-danger',
      accept: async () => {
        try {
          await this.actualizarEstadoYStock(pedido, 'RECHAZADA', 'COTIZACION', false, false);
          this.messageService.add({
            severity: 'success',
            summary: 'Cotización rechazada',
            detail: `La cotización ${pedido.folio} fue marcada como rechazada.`
          });
        } catch (e: any) {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'No se pudo rechazar la cotización: ' + e.message
          });
        }
      }
    });
  }

  async generarPDF(pedido: any) {
    if (this.generatingPdfId === pedido.id) return;
    this.generatingPdfId = pedido.id;
    
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
      this.generatingPdfId = null;
    }
  }

  compartirWhatsApp(pedido: any) {
    const trackingUrl = `https://sigo-wm.vercel.app/rastreo-cliente/${pedido.tracking_token || pedido.folio}`;
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
      
      const initLat = pedido.lat_destino != null ? Number(pedido.lat_destino) : null;
      const initLng = pedido.lng_destino != null ? Number(pedido.lng_destino) : null;

      this.conversionConfig = {
        estadoPago: 'PENDIENTE',
        diasCredito: 0,
        montoAdelanto: 0,
        metodoPago: 'EFECTIVO',
        referencia: '',
        lat_destino: initLat,
        lng_destino: initLng
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
      this.conversionConfig.diasCredito,
      this.conversionConfig.lat_destino,
      this.conversionConfig.lng_destino
    );

    // Al convertir a Venta con pago inmediato, registrar el comprobante en `pagos`.
    // Antes, solo se actualizaba el campo estado_pago del pedido sin crear la fila
    // en pagos. Con el trigger fn_sincronizar_pago_pedido esto revertía el estado
    // a PENDIENTE porque SUM(pagos) era 0.
    const ep = this.conversionConfig.estadoPago;
    if ((ep === 'PAGADO' || ep === 'PARCIAL') && this.pedidoAConvertir) {
      const total = Number(this.pedidoAConvertir.total) || 0;
      const montoPago = ep === 'PAGADO' 
        ? total 
        : (ep === 'PARCIAL' ? (Number(this.conversionConfig.montoAdelanto) || 0) : 0);

      if (montoPago > 0) {
        const usuario = this.authService.currentUser();
        await this.supabase
          .from('pagos')
          .insert({
            pedido_id: this.pedidoAConvertir.id,
            monto_pagado: montoPago,
            metodo_pago: this.conversionConfig.metodoPago || 'EFECTIVO',
            referencia_operacion: this.conversionConfig.referencia || 'Pago registrado al convertir cotización',
            usuario_id: usuario?.id
          });
      }
    }

    this.loadPedidos();
  }

  cancelarConversion() {
    this.displayConversionDialog = false;
    this.loadPedidos(); // Revert dropdown
  }

  async actualizarEstadoYStock(pedido: any, nuevoEstado: string, tipoNuevo: string, wasDeducted: boolean, willBeDeducted: boolean, estadoPagoForzado?: string, diasCredito?: number, lat_destino?: number | null, lng_destino?: number | null) {
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

         await this.actualizarEstado(pedido.id, nuevoEstado, tipoNuevo, estadoPagoFinal, finalDiasCredito, fechaVencimiento, lat_destino, lng_destino);
         
         // 4. Update view model
         const tipoOriginal = pedido.tipo_documento;
         pedido.estado = nuevoEstado;
         pedido.tipo_documento = tipoNuevo;
         pedido.estado_pago = estadoPagoFinal;
         if (lat_destino != null && lng_destino != null) {
           pedido.lat_destino = lat_destino;
           pedido.lng_destino = lng_destino;
         }
         if (tipoNuevo === 'ORDEN_VENTA' && tipoOriginal === 'COTIZACION' && !estadoPagoForzado) {
             pedido.estado_pago = 'PENDIENTE';
         }
     } catch (e: any) {
         alert('Error procesando el cambio de estado: ' + e.message);
         this.loadPedidos();
     }
  }

  async actualizarEstado(id: string, estado: string, tipo_documento: string, estado_pago: string, dias_credito?: number, fecha_vencimiento?: Date | null, lat_destino?: number | null, lng_destino?: number | null) {
    const payload: any = { estado, tipo_documento, estado_pago };
    
    if (dias_credito !== undefined) {
      payload.dias_credito = dias_credito;
    }
    if (fecha_vencimiento !== undefined) {
      payload.fecha_vencimiento = fecha_vencimiento ? fecha_vencimiento.toISOString().split('T')[0] : null;
    }
    if (lat_destino != null && lng_destino != null) {
      payload.lat_destino = lat_destino;
      payload.lng_destino = lng_destino;
      payload.lugar_entrega = 'OBRA';
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
    this.saldoDeudor = Math.round((Number(pedido.total) - totalPagado) * 100) / 100;

    this.nuevoPago = {
      monto: this.saldoDeudor > 0 ? this.saldoDeudor : 0,
      metodo: 'EFECTIVO',
      referencia: ''
    };

    this.displayPagosModal = true;
  }

  async registrarAbono() {
    const montoRondeado = Math.round((this.nuevoPago.monto || 0) * 100) / 100;
    const saldoRondeado = Math.round(this.saldoDeudor * 100) / 100;
    if (montoRondeado <= 0 || montoRondeado > saldoRondeado) {
      alert('El monto a pagar debe ser mayor a 0 y no puede exceder el saldo deudor pendiente (S/ ' + saldoRondeado.toFixed(2) + ').');
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

      // 2. Calcular nuevo saldo para actualizar modelo local (el trigger DB fn_sincronizar_pago_pedido ya actualiza pedidos en PostgreSQL)
      const nuevoTotalPagado = this.historialPagos.reduce((acc, p) => acc + Number(p.monto_pagado), 0) + this.nuevoPago.monto;
      const nuevoSaldo = Number(this.selectedPedidoPagos.total) - nuevoTotalPagado;
      let nuevoEstadoPago = 'PARCIAL';
      
      if (nuevoSaldo <= 0) {
        nuevoEstadoPago = 'PAGADO';
      }

      // 3. Refrescar datos locales
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
