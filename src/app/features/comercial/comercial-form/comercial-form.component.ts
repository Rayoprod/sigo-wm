import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AuthService } from '../../../core/services/auth.service';
import { ApiPeruService } from '../../../core/services/api-peru.service';
import { CE_SIN_AUTOCOMPLETAR, getTipoDocumento } from '../../../shared/utils/documento-identidad';
import { TablaCarritoComponent, CarritoItem } from './tabla-carrito/tabla-carrito.component';
import { InventarioService } from '../../../core/services/inventario.service';
import * as L from 'leaflet';

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
  preciosConIgv = false;

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

  lat_destino: number | null = null;
  lng_destino: number | null = null;

  // Selección de punto de entrega en el mapa (modal grande interactivo)
  displayMapaModal = false;
  coordsTemp: { lat: number; lng: number } | null = null;
  direccionTemp = '';
  direccionPunto = ''; // Dirección confirmada para mostrar en la tarjeta
  busquedaQuery = '';
  resultadosBusqueda: any[] = [];
  buscandoLugar = false;
  locating = false;
  private mapaModalMap: L.Map | null = null;
  private mapaModalMarker: L.Marker | null = null;
  private busquedaTimer: any = null;
  private reverseGeocodeDebounced: any = null;

  // Venta Exclusives
  metodosPago = [
    { label: 'Efectivo', value: 'EFECTIVO' },
    { label: 'Transferencia', value: 'TRANSFERENCIA' },
    { label: 'Yape / Plin', value: 'YAPE_PLIN' },
    { label: 'Tarjeta', value: 'TARJETA' }
  ];
  metodo_pago = 'EFECTIVO';
  
  estadosFinancieros = [
    { label: 'Pendiente (Sin pago por ahora)', value: 'PENDIENTE' },
    { label: 'Pagado Completo', value: 'PAGADO' },
    { label: 'Pago Parcial / Adelanto (Crédito)', value: 'PARCIAL' }
  ];
  estado_pago: 'PENDIENTE' | 'PARCIAL' | 'PAGADO' = 'PENDIENTE';
  monto_adelanto: number | null = null;
  numero_operacion = '';
  dias_credito = 0;
  
  // PDF Options
  opcionesPdf: string[] = ['validez', 'cuentas'];

  setEstadoPago(val: string) {
    this.estado_pago = val as any;
  }
  setMetodoPago(val: string) {
    this.metodo_pago = val;
  }

  isSaving = false;

  onPreciosConIgvChange() { this.recalcularTotales(); }
  
  // ─── Mapa: selección de punto de entrega ───────────────────────────────
  // La tarjeta del formulario muestra el estado (con/sin punto) y abre el
  // modal grande donde se ubica el punto con búsqueda, GPS o clic en el mapa.

  private pinIcon(): L.DivIcon {
    const color = '#dc2626';
    const size = 36;
    const html = `
      <div class="mapa-pin" style="width:${size}px;height:${size}px;">
        <svg viewBox="0 0 24 24" width="${size}" height="${size}">
          <path fill="${color}" stroke="#ffffff" stroke-width="1.4"
                d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
          <circle cx="12" cy="9" r="3.2" fill="#ffffff"/>
        </svg>
      </div>`;
    return L.divIcon({
      className: 'mapa-pin-wrapper',
      html,
      iconSize: [size, size],
      iconAnchor: [size / 2, size]
    });
  }

  abrirMapaGrande(): void {
    this.displayMapaModal = true;
    setTimeout(() => this.initMapaModal(), 150);
  }

  private initMapaModal(): void {
    const container = document.getElementById('mapa-destino-modal');
    if (!container) return;
    this.destroyMapaModal();

    this.mapaModalMap = L.map(container, { maxZoom: 19, attributionControl: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(this.mapaModalMap);

    this.coordsTemp = (this.lat_destino && this.lng_destino) ? { lat: this.lat_destino, lng: this.lng_destino } : null;
    this.direccionTemp = '';
    this.resultadosBusqueda = [];
    this.busquedaQuery = '';

    const centro: [number, number] = this.coordsTemp ? [this.coordsTemp.lat, this.coordsTemp.lng] : [-12.046374, -77.042793];
    this.mapaModalMap.setView(centro, this.coordsTemp ? 16 : 12);

    if (this.coordsTemp) {
      this.colocarPinModal(this.coordsTemp.lat, this.coordsTemp.lng, false);
      this.reverseGeocode(this.coordsTemp.lat, this.coordsTemp.lng);
    }

    this.mapaModalMap.on('click', (e: L.LeafletMouseEvent) => {
      this.colocarPinModal(e.latlng.lat, e.latlng.lng, true);
    });

    // El diálogo anima su tamaño al abrir: recalcular el mapa cuando ya es visible
    setTimeout(() => this.mapaModalMap?.invalidateSize(), 250);
    setTimeout(() => this.mapaModalMap?.invalidateSize(), 500);
  }

  private destroyMapaModal(): void {
    if (this.mapaModalMap) {
      try { this.mapaModalMap.remove(); } catch (e) {}
      this.mapaModalMap = null;
      this.mapaModalMarker = null;
    }
  }

  private colocarPinModal(lat: number, lng: number, geocodificar: boolean): void {
    this.coordsTemp = { lat, lng };
    if (!this.mapaModalMap) return;

    if (this.mapaModalMarker) {
      this.mapaModalMarker.setLatLng([lat, lng]);
    } else {
      this.mapaModalMarker = L.marker([lat, lng], { icon: this.pinIcon(), draggable: true }).addTo(this.mapaModalMap);
      this.mapaModalMarker.on('dragend', (e: any) => {
        const p = e.target.getLatLng();
        this.coordsTemp = { lat: p.lat, lng: p.lng };
        this.reverseGeocode(p.lat, p.lng);
      });
    }
    if (geocodificar) this.reverseGeocode(lat, lng);
  }

  confirmarPuntoMapa(): void {
    if (!this.coordsTemp) return;
    this.lat_destino = this.coordsTemp.lat;
    this.lng_destino = this.coordsTemp.lng;
    this.direccionPunto = this.direccionTemp;

    // Si aún no hay referencia escrita, pre-completar con la dirección del punto
    if (this.direccionTemp && !(this.direccion_entrega_detalle || '').trim()) {
      this.direccion_entrega_detalle = this.direccionTemp;
    }

    this.cerrarMapaGrande();
  }

  cerrarMapaGrande(): void {
    clearTimeout(this.busquedaTimer);
    this.displayMapaModal = false;
    this.coordsTemp = null;
    this.direccionTemp = '';
    this.resultadosBusqueda = [];
    this.busquedaQuery = '';
    this.destroyMapaModal();
  }

  limpiarPuntoDestinoForm(): void {
    this.lat_destino = null;
    this.lng_destino = null;
    this.coordsTemp = null;
    this.direccionTemp = '';
    this.direccionPunto = '';
  }

  usarMiUbicacionEnMapa(): void {
    if (!navigator.geolocation) {
      alert('Tu navegador no soporta geolocalización');
      return;
    }
    this.locating = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.locating = false;
        const { latitude, longitude } = position.coords;
        if (this.mapaModalMap) this.mapaModalMap.setView([latitude, longitude], 16);
        this.colocarPinModal(latitude, longitude, true);
      },
      (error) => {
        this.locating = false;
        alert('No se pudo obtener tu ubicación: ' + error.message);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // Búsqueda de direcciones (Nominatim / OpenStreetMap)
  onBuscarLugar(): void {
    const q = (this.busquedaQuery || '').trim();
    if (q.length < 3) {
      this.resultadosBusqueda = [];
      return;
    }
    clearTimeout(this.busquedaTimer);
    this.busquedaTimer = setTimeout(() => this.ejecutarBusqueda(q), 450);
  }

  private async ejecutarBusqueda(q: string): Promise<void> {
    this.buscandoLugar = true;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=es&q=${encodeURIComponent(q)}`,
        { headers: { Accept: 'application/json' } }
      );
      if (!res.ok) {
        this.resultadosBusqueda = [];
        return;
      }
      const data = await res.json();
      this.resultadosBusqueda = Array.isArray(data) ? data : [];
    } catch (e) {
      this.resultadosBusqueda = [];
    } finally {
      this.buscandoLugar = false;
    }
  }

  seleccionarResultadoBusqueda(r: any): void {
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    if (isNaN(lat) || isNaN(lng)) return;
    clearTimeout(this.busquedaTimer);
    this.busquedaQuery = r.display_name || '';
    this.resultadosBusqueda = [];
    if (this.mapaModalMap) this.mapaModalMap.setView([lat, lng], 17);
    this.colocarPinModal(lat, lng, false);
    this.direccionTemp = r.display_name || '';
  }

  private reverseGeocode(lat: number, lng: number): void {
    clearTimeout(this.reverseGeocodeDebounced);
    this.reverseGeocodeDebounced = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=es&lat=${lat}&lon=${lng}`,
          { headers: { Accept: 'application/json' } }
        );
        if (!res.ok) return;
        const data = await res.json();
        this.direccionTemp = this.resumenDireccion(data) || data?.display_name || '';
      } catch (e) {
        this.direccionTemp = '';
      }
    }, 400);
  }

  private resumenDireccion(data: any): string {
    const a = data?.address || {};
    const partes = [a.house_number, a.road, a.neighbourhood, a.suburb, a.city_district, a.city, a.state];
    const corta = partes.filter((p: any) => p && String(p).trim()).join(', ');
    return corta.length > 120 ? corta.slice(0, 117) + '…' : corta;
  }

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

  tiposEntrega = [
    { label: 'A Domicilio (Con GPS)', value: 'DOMICILIO' },
    { label: 'En Cantera (Recojo en Planta)', value: 'CANTERA' }
  ];
  tipo_entrega: 'DOMICILIO' | 'CANTERA' = 'DOMICILIO';

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.pedidoIdAEditar = id;
      await this.cargarPedido(id);
    } else {
      // Sin mapa embebido: el punto se ubica desde la tarjeta "Seleccionar en el mapa"
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.busquedaTimer);
    clearTimeout(this.reverseGeocodeDebounced);
    this.destroyMapaModal();
  }

  onTipoEntregaChange() {
    if (this.tipo_entrega === 'CANTERA') {
      this.lugar_entrega = 'CANTERA';
      this.direccion_entrega_detalle = '';
      this.lat_destino = null;
      this.lng_destino = null;
      this.direccionPunto = '';
    } else {
      this.lugar_entrega = 'OBRA';
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
    this.tipo_entrega = pedido.tipo_entrega || 'DOMICILIO';
    this.clienteActual = pedido.clientes;
    this.clienteSearchText = this.clienteActual.nombre_razon_social;
    
    this.lugar_entrega = pedido.lugar_entrega || 'CANTERA';
    this.direccion_entrega_detalle = pedido.direccion_entrega_detalle || '';
    this.lat_destino = pedido.lat_destino || null;
    this.lng_destino = pedido.lng_destino || null;
    this.dias_validez_oferta = pedido.dias_validez_oferta || 7;
    this.dias_credito = pedido.dias_credito || 0;
    this.observaciones = pedido.observaciones || '';
    this.descuento_global = pedido.descuento_global || 0;
    this.preciosConIgv = pedido.precios_con_igv === true;
    this.afectaIgv = !this.preciosConIgv && Number(pedido.igv) > 0;
    
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

      // 2. Si no existe, buscar en SUNAT/RENIEC (solo DNI/RUC; el CE se ingresa manualmente)
      const tipoDoc = getTipoDocumento(doc);
      if (!tipoDoc) {
        throw new Error('El documento debe ser un DNI (8 dígitos), RUC (11 dígitos) o Carné de Extranjería.');
      }
      if (tipoDoc === 'CE') {
        alert(CE_SIN_AUTOCOMPLETAR);
        return;
      }

      const res = await this.apiPeru.buscarDocumento(doc);
      if (res && res.success !== false) {
        const data = res.data ? res.data : res;
        this.clienteActual.id = null; // Es nuevo
        this.clienteActual.direccion = '';
        this.clienteActual.telefono = '';
        this.clienteActual.correo = '';
        
        if (tipoDoc === 'DNI') {
          const paterno = data.apellido_paterno || data.apellidoPaterno || '';
          const materno = data.apellido_materno || data.apellidoMaterno || '';
          this.clienteActual.nombre_razon_social = `${data.nombres || ''} ${paterno} ${materno}`.trim();
          this.clienteSearchText = this.clienteActual.nombre_razon_social;
        } else if (tipoDoc === 'RUC') {
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
    
    if (this.preciosConIgv) {
      // Los precios ya incluyen el 18%: el IGV se extrae (solo informativo) y NO se suma al total
      this.igv = Math.round(neto * 0.18 / 1.18 * 100) / 100;
      this.total = neto;
    } else if (this.afectaIgv) {
      this.igv = Math.round(neto * 0.18 * 100) / 100;
      this.total = neto + this.igv;
    } else {
      this.igv = 0;
      this.total = neto;
    }
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
          tipo_entrega: this.tipo_entrega,
          cliente_id: clienteId,
          lugar_entrega: this.lugar_entrega,
          direccion_entrega_detalle: this.lugar_entrega === 'OBRA' ? this.direccion_entrega_detalle : null,
          lat_destino: this.lugar_entrega === 'OBRA' ? this.lat_destino : null,
          lng_destino: this.lugar_entrega === 'OBRA' ? this.lng_destino : null,
          dias_validez_oferta: this.tipo_documento === 'COTIZACION' ? this.dias_validez_oferta : null,
          dias_credito: this.tipo_documento === 'ORDEN_VENTA' ? this.dias_credito : null,
          fecha_vencimiento: fecha_vencimiento,
          subtotal: this.subtotal,
          descuento_global: this.descuento_global || 0,
          igv: this.igv,
          total: this.total,
          precios_con_igv: this.preciosConIgv,
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
