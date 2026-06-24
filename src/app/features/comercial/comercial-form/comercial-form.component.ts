import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AuthService } from '../../../core/services/auth.service';
import { ApiPeruService } from '../../../core/services/api-peru.service';
import { TablaCarritoComponent, CarritoItem } from '../../../shared/components/tabla-carrito/tabla-carrito.component';
import { InventarioService } from '../../../core/services/inventario.service';

// PrimeNG
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DropdownModule } from 'primeng/dropdown';
import { SelectButtonModule } from 'primeng/selectbutton';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { CheckboxModule } from 'primeng/checkbox';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { InputSwitchModule } from 'primeng/inputswitch';
import { DividerModule } from 'primeng/divider';
import { DialogModule } from 'primeng/dialog';

@Component({
  selector: 'app-comercial-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    TablaCarritoComponent,
    CardModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    DropdownModule,
    SelectButtonModule,
    InputTextareaModule,
    CheckboxModule,
    AutoCompleteModule,
    InputSwitchModule,
    DividerModule,
    DialogModule
  ],
  templateUrl: './comercial-form.component.html',
  styleUrl: './comercial-form.component.scss'
})
export class ComercialFormComponent implements OnInit {
  supabase = inject(SupabaseService).client;
  auth = inject(AuthService);
  router = inject(Router);
  route = inject(ActivatedRoute);
  apiPeru = inject(ApiPeruService);
  inventarioService = inject(InventarioService);

  pedidoIdAEditar: string | null = null;
  folioAEditar: string | null = null;
  tipoDocumentoOriginal: string | null = null;
  estadoOriginal: string | null = null;

  // Smart Client Search
  isSearchingDoc = false;
  modoCliente: 'existente' | 'nuevo' = 'existente';
  clienteFiltro: any[] = [];
  
  clienteActual: any = {
    id: null,
    documento_identidad: '',
    nombre_razon_social: '',
    direccion: '',
    telefono: '',
    correo: ''
  };

  // Document Type
  tipoDocumentos = [
    { label: 'Cotización', value: 'COTIZACION' },
    { label: 'Venta Directa', value: 'ORDEN_VENTA' }
  ];
  tipo_documento: 'COTIZACION' | 'ORDEN_VENTA' = 'COTIZACION';

  // Carrito
  items: CarritoItem[] = [];

  // Totals
  subtotal = 0;
  descuento_global: number | null = null;
  igv = 0;
  total = 0;
  afectaIgv = false;

  // Step 3: Condiciones
  lugaresEntrega = [
    { label: 'Recojo en Cantera', value: 'CANTERA' },
    { label: 'Entrega en Obra', value: 'OBRA' }
  ];
  lugar_entrega = 'CANTERA';
  direccion_entrega_detalle = '';

  // Cotizacion Exclusives
  dias_validez_oferta = 7;
  incluir_cuentas = true;
  observaciones = '';

  // Venta Exclusives
  metodosPago = [
    { label: 'Efectivo', value: 'EFECTIVO' },
    { label: 'Transferencia', value: 'TRANSFERENCIA' },
    { label: 'Yape / Plin', value: 'YAPE_PLIN' },
    { label: 'Tarjeta', value: 'TARJETA' }
  ];
  metodo_pago = 'EFECTIVO';
  
  estadosFinancieros = [
    { label: 'Pagado Completo', value: 'PAGADO' },
    { label: 'Pago Parcial (Crédito)', value: 'PARCIAL' }
  ];
  estado_pago: 'PENDIENTE' | 'PARCIAL' | 'PAGADO' = 'PENDIENTE';
  monto_adelanto: number | null = null;
  numero_operacion = '';
  dias_credito = 0;
  
  // PDF Options
  opcionesPdf: string[] = ['validez', 'cuentas'];

  isSaving = false;

  get isClienteValido(): boolean {
    return !!(this.clienteActual.nombre_razon_social && this.clienteActual.documento_identidad);
  }

  get isItemsValido(): boolean {
    // Validar que no haya ítems vacíos, que tengan cantidad y que tengan producto_id (del catálogo)
    return this.items.length > 0 && this.items.every(i => i.descripcion && (i.cantidad || 0) > 0 && i.producto_id);
  }

  get hasAdelantoValido() {
    if (this.tipo_documento === 'COTIZACION') return true;
    if (this.estado_pago !== 'PARCIAL') return true;
    return this.monto_adelanto !== null && this.monto_adelanto >= 0 && this.monto_adelanto <= this.total;
  }

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.pedidoIdAEditar = id;
      await this.cargarPedido(id);
    }
  }

  async cargarPedido(id: string) {
    const { data: pedido, error } = await this.supabase
      .from('pedidos')
      .select('*, clientes(*), pedidos_items(*, productos(*))')
      .eq('id', id)
      .single();

    if (error || !pedido) return;

    this.folioAEditar = pedido.folio;
    this.tipoDocumentoOriginal = pedido.tipo_documento;
    this.estadoOriginal = pedido.estado;
    this.tipo_documento = pedido.tipo_documento;
    this.estado_pago = pedido.estado_pago || 'PENDIENTE';
    this.clienteActual = pedido.clientes;
    this.clienteSearchText = this.clienteActual.nombre_razon_social;
    
    this.lugar_entrega = pedido.lugar_entrega || 'CANTERA';
    this.direccion_entrega_detalle = pedido.direccion_entrega_detalle || '';
    this.dias_validez_oferta = pedido.dias_validez_oferta || 7;
    this.dias_credito = pedido.dias_credito || 0;
    this.observaciones = pedido.observaciones || '';
    this.descuento_global = pedido.descuento_global || 0;
    
    if (pedido.pedidos_items) {
      this.items = pedido.pedidos_items.map((i: any) => ({
        producto_id: i.producto_id,
        producto_obj: i.producto_id ? { id: i.producto_id, descripcion: i.productos?.descripcion, unidad_medida: i.productos?.unidad_medida, precio_unitario_base: i.productos?.precio_unitario_base } : null,
        codigo_sku: i.productos?.codigo_sku || 'MANUAL',
        descripcion: i.descripcion_manual || i.productos?.descripcion,
        unidad_medida: i.unidad_medida_manual || i.productos?.unidad_medida,
        cantidad: i.cantidad,
        precio_unitario: i.precio_unitario,
        subtotal: i.subtotal,
        is_custom: !i.producto_id
      }));
      this.recalcularTotales();
    }
  }

  async buscarClienteLocal(event: any) {
    const query = event.query;
    const { data } = await this.supabase
      .from('clientes')
      .select('*')
      .or(`nombre_razon_social.ilike.%${query}%,documento_identidad.ilike.%${query}%`)
      .limit(10);
    this.clienteFiltro = data || [];
  }

  clienteSearchText: any = '';

  onClienteSelect(event: any) {
    if (!event) return;
    
    // PrimeNG a veces emite { originalEvent, value } o solo el value
    const cliente = event.value || event;
    
    // Asignamos las propiedades del cliente actual
    this.clienteActual.id = cliente.id || null;
    this.clienteActual.nombre_razon_social = cliente.nombre_razon_social || '';
    this.clienteActual.documento_identidad = cliente.documento_identidad || '';
    this.clienteActual.direccion = cliente.direccion || '';
    this.clienteActual.telefono = cliente.telefono || '';
    this.clienteActual.correo = cliente.correo || '';
    
    // Usamos setTimeout para limpiar el objeto de la caja de texto y poner solo el string
    setTimeout(() => {
      this.clienteSearchText = cliente.nombre_razon_social;
    });
  }

  onNombreChange(val: any) {
    if (typeof val === 'string') {
      // El usuario está escribiendo a mano
      this.clienteActual.nombre_razon_social = val;
      this.clienteActual.id = null; // Ya no es un cliente de la BD
    } else if (val && typeof val === 'object') {
      // PrimeNG acaba de inyectar un objeto al seleccionar
      setTimeout(() => {
        this.clienteSearchText = val.nombre_razon_social || val.value?.nombre_razon_social;
      });
    }
  }

  cambiarModoCliente(modo: 'existente' | 'nuevo') {
    this.modoCliente = modo;
    this.clienteActual = { id: null, documento_identidad: '', nombre_razon_social: '', direccion: '', telefono: '', correo: '' };
    this.clienteSearchText = '';
  }

  async buscarDocApiPeru() {
    const doc = this.clienteActual.documento_identidad?.trim();

    if (!doc) return;
    
    this.clienteActual.documento_identidad = doc;
    this.isSearchingDoc = true;
    try {
      // 1. Buscar en BD Local
      const { data: localData } = await this.supabase
        .from('clientes')
        .select('*')
        .eq('documento_identidad', doc)
        .maybeSingle();

      console.log('[buscarDocApiPeru] local search result:', localData);

      if (localData) {
        this.clienteActual.id = localData.id;
        this.clienteActual.nombre_razon_social = localData.nombre_razon_social || '';
        this.clienteActual.documento_identidad = localData.documento_identidad || '';
        this.clienteActual.direccion = localData.direccion || '';
        this.clienteActual.telefono = localData.telefono || '';
        this.clienteActual.correo = localData.correo || '';
        
        console.log('[buscarDocApiPeru] clienteActual updated from localData:', { ...this.clienteActual });

        this.clienteSearchText = localData.nombre_razon_social || '';
        this.isSearchingDoc = false;
        return;
      }

      // 2. Si no existe, buscar en SUNAT/RENIEC
      if (doc.length !== 8 && doc.length !== 11) {
        throw new Error('El documento debe tener 8 (DNI) o 11 (RUC) dígitos.');
      }

      const res = await this.apiPeru.buscarDocumento(doc);
      if (res && res.success !== false) {
        const data = res.data ? res.data : res;
        this.clienteActual.id = null; // Es nuevo
        this.clienteActual.direccion = '';
        this.clienteActual.telefono = '';
        this.clienteActual.correo = '';
        
        if (doc.length === 8) {
          const paterno = data.apellido_paterno || data.apellidoPaterno || '';
          const materno = data.apellido_materno || data.apellidoMaterno || '';
          this.clienteActual.nombre_razon_social = `${data.nombres || ''} ${paterno} ${materno}`.trim();
          this.clienteSearchText = this.clienteActual.nombre_razon_social;
        } else if (doc.length === 11) {
          this.clienteActual.nombre_razon_social = data.nombre_o_razon_social || data.razonSocial || '';
          this.clienteSearchText = this.clienteActual.nombre_razon_social;
          this.clienteActual.direccion = data.direccion_completa || data.direccion || '';
        }
      } else {
        alert(res.message || 'No se encontró información para este documento.');
      }
    } catch (e: any) {
      alert('Aviso: ' + e.message);
    } finally {
      this.isSearchingDoc = false;
    }
  }

  recalcularTotales() {
    this.subtotal = this.items.reduce((acc, item) => acc + (item.subtotal || 0), 0);
    const neto = this.subtotal - (this.descuento_global || 0);
    
    if (this.afectaIgv) {
      this.igv = neto * 0.18;
    } else {
      this.igv = 0;
    }
    
    this.total = neto + this.igv;
  }

  onItemsChange(newItems: CarritoItem[]) {
    this.items = newItems;
    this.recalcularTotales();
  }

  async guardar() {
    // Validar visualmente en HTML en lugar de showAlert (el botón estará deshabilitado, pero por si acaso)
    if (!this.isClienteValido || !this.isItemsValido) {
      alert("Faltan datos requeridos en el cliente o los ítems.");
      return;
    }
    
    if (!this.hasAdelantoValido) {
      alert("El monto de adelanto no puede ser mayor o igual al total de la venta.");
      return;
    }

    this.isSaving = true;
    try {
      let clienteId = this.clienteActual.id;

      // Auto-crear cliente si no existe en BD
      if (!clienteId) {
        if (!this.clienteActual.documento_identidad) { alert("Documento es obligatorio"); return; }
        const { data: newClient, error: errClient } = await this.supabase
          .from('clientes')
          .insert({
            documento_identidad: this.clienteActual.documento_identidad,
            nombre_razon_social: this.clienteActual.nombre_razon_social,
            direccion: this.clienteActual.direccion,
            telefono: this.clienteActual.telefono,
            correo: this.clienteActual.correo
          })
          .select('id')
          .single();
        
        if (errClient) throw errClient;
        clienteId = newClient.id;
        this.clienteActual.id = clienteId; // Actualizar localmente
      }
      // 1. Generar Folio (Manejado por DB Trigger)
      // El folio se generará automáticamente en Supabase si es nuevo.

      // 2. Calcular Fecha de Vencimiento si es crédito
      let fecha_vencimiento = null;
      if (this.tipo_documento === 'ORDEN_VENTA' && this.estado_pago === 'PARCIAL' && this.dias_credito > 0) {
        const date = new Date();
        date.setDate(date.getDate() + this.dias_credito);
        fecha_vencimiento = date.toISOString().split('T')[0];
      }

      // 3. Insertar o Actualizar Maestro
      const vendedor_id = this.auth.currentUser()?.id;
      const estado_doc = this.tipo_documento === 'COTIZACION' ? 'PENDIENTE' : 'APROBADA';
      
      let pId = this.pedidoIdAEditar;
      const pedidoData = {
          tipo_documento: this.tipo_documento,
          estado: estado_doc,
          estado_pago: this.tipo_documento === 'COTIZACION' ? 'PENDIENTE' : this.estado_pago,
          cliente_id: clienteId,
          lugar_entrega: this.lugar_entrega,
          direccion_entrega_detalle: this.lugar_entrega === 'OBRA' ? this.direccion_entrega_detalle : null,
          dias_validez_oferta: this.tipo_documento === 'COTIZACION' ? this.dias_validez_oferta : null,
          subtotal: this.subtotal,
          descuento_global: this.descuento_global || 0,
          igv: this.igv,
          total: this.total,
          observaciones: this.observaciones
      };

      let docFolio = this.folioAEditar;
      if (this.pedidoIdAEditar) {
        // UPDATE
        const { error: errMaestro } = await this.supabase
          .from('pedidos')
          .update(pedidoData)
          .eq('id', this.pedidoIdAEditar);
        if (errMaestro) throw errMaestro;
        
        // Reponer stock si originalmente era una ORDEN_VENTA y su estado indicaba descuento
        const wasDeducted = this.tipoDocumentoOriginal === 'ORDEN_VENTA' && 
                            (this.estadoOriginal === 'APROBADA' || this.estadoOriginal === 'COMPLETADA');
                            
        if (wasDeducted) {
            await this.inventarioService.reponerStockPorVenta(this.pedidoIdAEditar, docFolio || '', 'Edición');
        }

        // Delete old items
        await this.supabase.from('pedidos_items').delete().eq('pedido_id', this.pedidoIdAEditar);
      } else {
        // INSERT
        const { data: newPedido, error: errMaestro } = await this.supabase
          .from('pedidos')
          .insert({
            ...pedidoData,
            vendedor_id
          })
          .select('id, folio')
          .single();
  
        if (errMaestro) throw errMaestro;
        pId = newPedido.id;
        docFolio = newPedido.folio;
      }

      // 4. Insertar Items
      const itemsToInsert = this.items.map(i => ({
        pedido_id: pId,
        producto_id: i.producto_id || null,
        descripcion_manual: i.is_custom ? i.descripcion : null,
        unidad_medida_manual: i.is_custom ? i.unidad_medida : null,
        cantidad: i.cantidad,
        precio_unitario: i.precio_unitario,
        subtotal: i.subtotal
      }));

      const { error: errItems } = await this.supabase
        .from('pedidos_items')
        .insert(itemsToInsert);
        
      if (errItems) throw errItems;

      // 5. Si es VENTA, procesar inventario y finanzas
      if (this.tipo_documento === 'ORDEN_VENTA') {
        const esNuevaVenta = !this.pedidoIdAEditar || (this.tipoDocumentoOriginal === 'COTIZACION' && this.tipo_documento === 'ORDEN_VENTA');
        
        if (esNuevaVenta) {
          if (this.estado_pago === 'PAGADO' || (this.estado_pago === 'PARCIAL' && this.monto_adelanto && this.monto_adelanto > 0)) {
            const montoAInsertar = this.estado_pago === 'PAGADO' ? this.total : (this.monto_adelanto || 0);
            const { error: errPago } = await this.supabase
              .from('pagos')
              .insert({
                pedido_id: pId,
                monto_pagado: montoAInsertar,
                metodo_pago: this.metodo_pago,
                referencia_operacion: this.numero_operacion,
                usuario_id: vendedor_id
              });
            if (errPago) throw errPago;
          }
        }

        // Descontar inventario 
        await this.inventarioService.descontarStockPorVenta(pId as string, docFolio || '');
      }

      this.router.navigate(['/comercial']);
    } catch (e: any) {
      alert('Error al guardar: ' + e.message);
      console.error(e);
    } finally {
      this.isSaving = false;
    }
  }


}
