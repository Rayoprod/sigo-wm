import { Component, OnInit, inject, OnDestroy, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService } from '../../core/services/supabase.service';
import { AuthService } from '../../core/services/auth.service';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { Pedidos, PedidosItems, ViajesEntregas, SesionesGps, RutasGps } from '../../core/models/app.models';

import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { InputNumberModule } from 'primeng/inputnumber';
import { ProgressBarModule } from 'primeng/progressbar';
import { DialogModule } from 'primeng/dialog';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { ImageModule } from 'primeng/image';
import { TimelineModule } from 'primeng/timeline';
import { DividerModule } from 'primeng/divider';
import { QRCodeModule } from 'angularx-qrcode';
import * as pako from 'pako';
import { PeruDatePipe } from '../../shared/pipes/peru-date.pipe';
import { buildLiveTruckIcon } from '../../shared/utils/live-truck-marker';

@Component({
  selector: 'app-logistica',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    TagModule,
    InputNumberModule,
    ProgressBarModule,
    DialogModule,
    TableModule,
    TooltipModule,
    DropdownModule,
    InputTextModule,
    ImageModule,
    TimelineModule,
    DividerModule,
    QRCodeModule,
    PeruDatePipe
  ],
  templateUrl: './logistica.component.html',
  styleUrl: './logistica.component.scss'
})
export class LogisticaComponent implements OnInit, OnDestroy {
  supabase = inject(SupabaseService).client;
  auth = inject(AuthService);
  ngZone = inject(NgZone);

  pedidos: Pedidos[] = [];
  loading = true;
  vehiculosOptions: { label: string, value: string }[] = [];

  // Detalles expandidos (Mobile y Desktop)
  expandedPedidoId: string | null = null;
  expandedRows: { [key: string]: boolean } = {};
  itemsDelPedidoMap: { [key: string]: PedidosItems[] } = {};
  loadingItemsMap: { [key: string]: boolean } = {};
  expandedViajeMap: { [key: number]: boolean } = {};

  displayViajeModal = false;
  displayMapInfoMobile = false;
  selectedPedido: Pedidos | null = null;
  viajeForm = {
    placa: '',
    lat: null as number | null,
    lng: null as number | null,
    fotosFiles: [] as File[],
    items: [] as any[] // [{ id, descripcion, maxCantidad, cantidad_viaje }]
  };
  isSavingViaje = false;
  gpsLoading = false;

  // Auditoría
  viajesAuditoria: any[] = []; // Unified map object

  // QR Transferencia
  displayQrModal = false;
  qrPayload = '';

  // Mapa y Rastreo
  displayRutaModal = false;
  displayImageModal = false;
  selectedImageUrl = '';
  selectedPedidoParaRuta: Pedidos | null = null;
  loadingRuta = false;
  puntosRuta: RutasGps[] = [];
  entregasRuta: ViajesEntregas[] = [];
  historialTracking: any[] = []; // Línea de tiempo unificada
  map: L.Map | null = null;
  polyline: L.Polyline | null = null;

  // ETA de entrega
  etaInfo: {
    eta: string;
    velocidadKmh: number;
    distanciaKm: number;
    edadMin: number;
    esEstimado: boolean;
    detenido: boolean;
    viajeNum: number;
  } | null = null;

  /**
   * Estado de foco del mapa. Un único objeto que controla qué se muestra.
   * null  → vista general: todos los viajes
   * { type: 'ruta', viajeItem }  → solo la ruta GPS del viaje seleccionado
   * { type: 'punto', lat, lng, label } → solo el punto del despachador
   */
  mapFocus: null | { type: 'ruta'; viajeItem: any } | { type: 'punto'; lat: number; lng: number; label: string } = null;

  // Grupos de capas para actualizaciones diferenciales sin parpadeo
  layerGroupTramos: L.LayerGroup | null = null;
  layerGroupMarcadores: L.LayerGroup | null = null;
  layerGroupVivo: L.LayerGroup | null = null;
  liveMarker: L.Marker | null = null;

  // ¿Ya se hizo el fitBounds inicial? Evita resetear el zoom en polling
  mapInitialBoundsDone = false;

  // Track showing GPS list independently of polling overwrites
  mostrarGpsMap: { [numeroViaje: number]: boolean } = {};

  realtimeChannel: any;
  rutaRealtimeChannel: any;
  rutaPollingInterval: any;
  globalPollingInterval: any;


  sesionesHuerfanas: any[] = [];

  async ngOnInit() {
    await this.cargarPedidos();
    await this.cargarVehiculos();
    this.suscribirCambiosViajes();
    // Panel de sesiones GPS huérfanas (desconectadas del flujo de despacho)
    await this.cargarSesionesHuerfanas();
  }

  ngOnDestroy() {
    if (this.realtimeChannel) this.supabase.removeChannel(this.realtimeChannel);
    if (this.rutaRealtimeChannel) this.supabase.removeChannel(this.rutaRealtimeChannel);
    if (this.rutaPollingInterval) clearInterval(this.rutaPollingInterval);
    if (this.globalPollingInterval) clearInterval(this.globalPollingInterval);
  }

  async cargarSesionesHuerfanas() {
    try {
      const { data } = await this.supabase
        .from('sesiones_gps')
        .select(`
          id, timestamp_inicio, timestamp_fin, estado,
          pedidos (folio),
          chofer:usuarios!sesiones_gps_chofer_id_fkey (nombre_completo),
          rutas_gps (count)
        `)
        .eq('estado', 'HUERFANA')
        .order('timestamp_inicio', { ascending: false });

      this.sesionesHuerfanas = (data || []).map((s: any) => ({
        ...s,
        pedido_folio: s.pedidos?.folio,
        chofer_nombre: s.chofer?.nombre_completo,
        puntos_gps: s.rutas_gps?.[0]?.count || 0,
      }));
    } catch (e) {
      console.error('Error cargando sesiones huerfanas:', e);
    }
  }

  async cargarVehiculos() {
    const { data } = await this.supabase.from('vehiculos').select('placa').order('placa');
    if (data) {
      this.vehiculosOptions = data.map(v => ({ label: v.placa, value: v.placa }));
    }
  }



  suscribirCambiosViajes() {
    this.realtimeChannel = this.supabase.channel('custom-viajes-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'despachos_viajes_detalle' }, payload => {
        const targets = new Set<string>();
        if (this.expandedPedidoId) targets.add(this.expandedPedidoId);
        Object.keys(this.expandedRows).forEach(id => {
          if (this.expandedRows[id]) targets.add(id);
        });

        for (const targetId of targets) {
          this.cargarItemsPedido(targetId, true);
        }
      })
      .subscribe();

    // Polling Híbrido Global: Se ejecuta cada 15 segundos para garantizar que 
    // la tabla principal, el modal de auditoría y los detalles expandidos 
    // se mantengan actualizados.
    this.globalPollingInterval = setInterval(() => {
      this.ngZone.run(async () => {
        // Refrescar lista de pedidos principal silenciosamente
        await this.cargarPedidos(true);
        
        // Si hay filas expandidas, refrescar sus items silenciosamente
        const targets = new Set<string>();
        if (this.expandedPedidoId) targets.add(this.expandedPedidoId);
        Object.keys(this.expandedRows).forEach(id => {
          if (this.expandedRows[id]) targets.add(id);
        });

        const fetchPromises: Promise<void>[] = [];
        for (const targetId of targets) {
          fetchPromises.push(this.cargarItemsPedido(targetId, true));
        }
        await Promise.all(fetchPromises);
      });
    }, 15000);
  }

  async cargarPedidos(silent: boolean = false) {
    if (!silent) this.loading = true;
    const { data, error } = await this.supabase
      .from('pedidos')
      .select('*, clientes(nombre_razon_social), chofer:usuarios!pedidos_chofer_id_fkey(nombre_completo)')
      .eq('tipo_documento', 'ORDEN_VENTA')
      .in('estado', ['APROBADA', 'COMPLETADA'])
      .order('created_at', { ascending: false });

    if (!error) {
      const nuevos = data || [];
      // Solo reasignar la referencia si realmente cambió algo, para evitar
      // que el polling global re-renderice toda la tabla en cada ciclo.
      const claveActual = this.pedidos.map(p => `${p.id}:${p.estado}:${p.updated_at || ''}`).join('|');
      const claveNueva = nuevos.map(p => `${p.id}:${p.estado}:${p.updated_at || ''}`).join('|');
      if (claveActual !== claveNueva) {
        this.pedidos = nuevos;
      }
    }
    if (!silent) this.loading = false;
  }

  // KPIs
  get kpiPendientes() {
    return this.pedidos.filter(p => p.estado === 'APROBADA').length;
  }
  
  get kpiCompletados() {
    return this.pedidos.filter(p => p.estado === 'COMPLETADA').length;
  }
  
  get kpiTotal() {
    return this.pedidos.length;
  }

  async togglePedido(pedidoId: string) {
    if (this.expandedPedidoId === pedidoId) {
      this.expandedPedidoId = null;
    } else {
      this.expandedPedidoId = pedidoId;
      await this.cargarItemsPedido(pedidoId);
    }
  }

  async onRowExpand(event: any) {
    const pedidoId = event.data.id;
    await this.cargarItemsPedido(pedidoId);
  }

  async onRowCollapse(event: any) {
    // Opcional: limpiar cache si quisieras, pero usualmente se deja guardado
  }

  async cargarItemsPedido(pedidoId: string, silent: boolean = false) {
    if (this.itemsDelPedidoMap[pedidoId] && !silent) return; // Evitar recarga si ya está en caché

    if (!silent) this.loadingItemsMap[pedidoId] = true;
    
    // 1. Cargar items del pedido
    const { data: items, error: errorItems } = await this.supabase
      .from('pedidos_items')
      .select('*, productos(descripcion, unidad_medida)')
      .eq('pedido_id', pedidoId);

    // 2. Cargar detalles de viajes asociados a este pedido para segmentar la barra
    const { data: detallesViajes } = await this.supabase
      .from('despachos_viajes_detalle')
      .select(`
        pedido_item_id, 
        cantidad_viaje, 
        despachos_viajes_cabecera!inner(numero_viaje_secuencial, estado_viaje, pedido_id)
      `)
      .eq('despachos_viajes_cabecera.pedido_id', pedidoId);

    if (!errorItems && items) {
      // 3. Procesar segmentos por viaje
      items.forEach((item: any) => {
        item.segmentosViajes = [];
        if (detallesViajes) {
           const detalles = detallesViajes.filter((d: any) => d.pedido_item_id === item.id);
           detalles.sort((a: any, b: any) => {
             const cabA = Array.isArray(a.despachos_viajes_cabecera) ? a.despachos_viajes_cabecera[0] : a.despachos_viajes_cabecera;
             const cabB = Array.isArray(b.despachos_viajes_cabecera) ? b.despachos_viajes_cabecera[0] : b.despachos_viajes_cabecera;
             return (cabA?.numero_viaje_secuencial || 0) - (cabB?.numero_viaje_secuencial || 0);
           });
           
           detalles.forEach((d: any) => {
              const cab = Array.isArray(d.despachos_viajes_cabecera) ? d.despachos_viajes_cabecera[0] : d.despachos_viajes_cabecera;
              if (!cab) return;
              item.segmentosViajes.push({
                 viajeSec: cab.numero_viaje_secuencial,
                 cantidad: Number(d.cantidad_viaje),
                 porcentaje: (Number(d.cantidad_viaje) / item.cantidad) * 100,
                 estado: cab.estado_viaje
              });
           });
        }
      });
      this.itemsDelPedidoMap[pedidoId] = items || [];
    }
    if (!silent) this.loadingItemsMap[pedidoId] = false;
  }

  // --- REGISTRO DE VIAJE (V2) ---

  async openViajeModal(pedido: any) {
    this.selectedPedido = pedido;
    this.displayViajeModal = true;
    
    // Preparar form con los items actuales
    await this.cargarItemsPedido(pedido.id);
    this.viajeForm = {
      placa: '',
      lat: null,
      lng: null,
      fotosFiles: [],
      items: (this.itemsDelPedidoMap[pedido.id] || []).map((item: any) => {
        // La base de datos ya suma todo en cantidad_despachada mediante el trigger,
        // no debemos volver a restar lo que está 'en tránsito'.
        // Redondeamos a 3 decimales (misma precisión de cantidades que usa la app
        // Flutter) para evitar residuos de punto flotante del tipo
        // 3 - 2.9999999999999996 = 4.440892098500626e-16, que creaban un
        // "pendiente de envío" fantasma y bloqueaban el botón de despacho.
        const cantidadTotal = this.round3(Number(item.cantidad) || 0);
        const despachado = this.round3(Number(item.cantidad_despachada) || 0);
        const restante = this.round3(cantidadTotal - despachado);
        return {
          id: item.id,
          descripcion: item.productos?.descripcion || item.descripcion_manual,
          unidad_medida: item.productos?.unidad_medida || item.unidad_medida_manual,
          maxCantidad: restante > 0 ? restante : 0,
          cantidad_viaje: 0
        };
      })
    };

    // Solicitar GPS automáticamente al abrir el modal
    this.capturarGPS();
  }

  /** Redondea a 3 decimales (misma precisión de cantidades que usa la app Flutter). */
  private round3(valor: number): number {
    return Math.round((valor + Number.EPSILON) * 1000) / 1000;
  }

  capturarGPS() {
    if (!navigator.geolocation) {
      alert("Tu navegador no soporta geolocalización");
      return;
    }
    this.gpsLoading = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.viajeForm.lat = pos.coords.latitude;
        this.viajeForm.lng = pos.coords.longitude;
        this.gpsLoading = false;
      },
      (err) => {
        alert("Error al capturar GPS: " + err.message);
        this.gpsLoading = false;
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  onFotoSeleccionada(event: any) {
    const files = event.target.files;
    if (files) {
      for(let i=0; i<files.length; i++){
        if(this.viajeForm.fotosFiles.length < 5){
          this.viajeForm.fotosFiles.push(files[i]);
        }
      }
    }
    // Limpiar input
    event.target.value = null;
  }

  eliminarFoto(index: number) {
    this.viajeForm.fotosFiles.splice(index, 1);
  }

  // Comprimir imagen localmente antes de subir (Optimizada para memoria en móviles)
  comprimirImagen(file: File): Promise<File> {
    return new Promise((resolve, reject) => {
      // 1. Usar createObjectURL en lugar de FileReader (readAsDataURL) para evitar 
      // saturar el Heap JS (RAM) con un string Base64 masivo que causa Out-Of-Memory.
      const url = URL.createObjectURL(file);
      const img = new Image();
      
      img.onload = () => {
        // 2. Liberar el puntero de memoria del Blob original inmediatamente
        URL.revokeObjectURL(url);
        
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Redimensionar si es muy grande (max 1200px)
        const MAX_WIDTH = 1200;
        const MAX_HEIGHT = 1200;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        // Convertir a JPEG con 70% de calidad
        canvas.toBlob(blob => {
          // 3. Forzar limpieza manual de memoria (Garbage Collection en móviles)
          canvas.width = 0;
          canvas.height = 0;
          img.src = '';
          
          if (blob) {
            const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
              type: 'image/jpeg',
              lastModified: Date.now()
            });
            resolve(newFile);
          } else {
            reject(new Error('Canvas to Blob failed'));
          }
        }, 'image/jpeg', 0.7);
      };
      
      img.onerror = error => {
        URL.revokeObjectURL(url);
        reject(error);
      };
      
      // Asignar url al final para iniciar carga
      img.src = url;
    });
  }

  // --- GENERADOR DE QR COMPRIMIDO ---
  generarPayloadQR(cabecera: any, detalles: any[]): string {
    if (!cabecera) return '';
    const safeDetalles = Array.isArray(detalles) ? detalles : [];

    const minMap = {
      t: 'h',
      i: cabecera.id || '',
      pi: cabecera.pedido_id || '',
      pf: this.selectedPedido?.folio || this.selectedPedidoParaRuta?.folio || '',
      pv: cabecera.placa_vehiculo || '',
      fd: new Date().toISOString(),
      ns: cabecera.numero_viaje_secuencial || 0,
      ci: cabecera.chofer_id || '',
      di: cabecera.despachador_id || '',
      dt: safeDetalles.map((d: any) => ({
        id: d?.id || '',
        pi: d?.pedido_item_id || '',
        cv: Number(d?.cantidad_viaje) || 0,
        desc: d?.pedidos_items?.productos?.descripcion || d?.pedidos_items?.descripcion_manual || d?.descripcion || 'Material',
        um: d?.pedidos_items?.productos?.unidad_medida || d?.pedidos_items?.unidad_medida_manual || d?.unidad_medida || 'UND'
      }))
    };

    const jsonStr = JSON.stringify(minMap);
    // Comprimir con gzip (pako)
    const compressed = pako.gzip(jsonStr);
    
    // Convertir Uint8Array a Base64 de forma segura
    const binary = Array.from(compressed).map((byte: any) => String.fromCharCode(byte)).join('');
    const base64Str = btoa(binary);

    return `sigo_wm://${base64Str}`;
  }

  mostrarQR(viaje: any) {
    if (!viaje || !viaje.despacho) return;
    
    // Preparar detalles (usar lo que viene de la auditoría)
    const detalles = viaje.despacho.despachos_viajes_detalle || [];
    this.qrPayload = this.generarPayloadQR(viaje.despacho, detalles);
    this.displayQrModal = true;
  }

  async guardarViaje() {
    const itemsAEnviar = this.viajeForm.items.filter(i => i.cantidad_viaje > 0);
    if (itemsAEnviar.length === 0) {
      alert("Debes indicar la cantidad a despachar de al menos un material.");
      return;
    }
    this.isSavingViaje = true;
    
    try {
      const user = this.auth.currentUser();
      let fotosUrls: string[] = [];

      // 1. Obtener/calcular numero_viaje_secuencial (clonando lógica Flutter)
      const { data: maxViajeData, error: maxViajeError } = await this.supabase
        .from('despachos_viajes_cabecera')
        .select('numero_viaje_secuencial')
        .eq('pedido_id', this.selectedPedido!.id)
        .order('numero_viaje_secuencial', { ascending: false })
        .limit(1);
        
      let numSecuencial = 1;
      if (maxViajeData && maxViajeData.length > 0 && maxViajeData[0].numero_viaje_secuencial) {
        numSecuencial = Number(maxViajeData[0].numero_viaje_secuencial) + 1;
      }

      // 2. Comprimir y Subir fotos usando la misma ruta que Flutter
      for (const file of this.viajeForm.fotosFiles) {
        const compressedFile = await this.comprimirImagen(file);
        
        // Generar nombre simulando el UUID v4 de Flutter y su timestamp
        const randomString = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
        const fileNameLocal = `${Date.now()}_${randomString}.jpg`;
        const filePath = `evidencias/pedidos/${this.selectedPedido!.folio}/viaje_${numSecuencial}/despachador/${fileNameLocal}`;

        const { error: uploadError } = await this.supabase.storage
          .from('assets')
          .upload(filePath, compressedFile);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = this.supabase.storage
          .from('assets')
          .getPublicUrl(filePath);
          
        fotosUrls.push(publicUrl);
      }

      // 1.6 Guardar placa en base de datos global (solo si no está en el catálogo local)
      if (this.viajeForm.placa && this.viajeForm.placa.trim().length > 0) {
        const p = this.viajeForm.placa.trim().toUpperCase();
          if (!this.vehiculosOptions.find(o => o.value === p)) {
          try {
            await this.supabase.from('vehiculos').insert({ placa: p });
            this.vehiculosOptions.push({ label: p, value: p });
          } catch (e) {
            // Ignorar error si ya existe (p.ej. otra pestaña ya la registró)
          }
        }
      }

      // 2. Insertar Cabecera.
      // Dos despachadores pueden calcular el mismo numero_viaje_secuencial
      // (max+1) casi en paralelo. Para evitar el choque de unicidad, se
      // reintenta recalculando el máximo hasta 3 veces.
      let cabeceraData: any = null;
      let insertError: any = null;
      for (let intento = 0; intento < 3 && !cabeceraData; intento++) {
        const { data: maxViajeData2 } = await this.supabase
          .from('despachos_viajes_cabecera')
          .select('numero_viaje_secuencial')
          .eq('pedido_id', this.selectedPedido!.id)
          .order('numero_viaje_secuencial', { ascending: false })
          .limit(1);

        let secIntent = 1;
        if (maxViajeData2 && maxViajeData2.length > 0 && maxViajeData2[0].numero_viaje_secuencial) {
          secIntent = Number(maxViajeData2[0].numero_viaje_secuencial) + 1;
        }

        // CANTERA (recojo en planta): la app móvil crea estos viajes directamente
        // como ENTREGADO y con lugar_entrega='CANTERA'. Replicamos la misma regla
        // de dominio en la web para evitar divergencias (antes se creaban como
        // 'ASIGNADO' y sin lugar_entrega, rompiendo el tracking en rastreo-cliente
        // y dejando viajes huérfanos que nunca pasaban por recepción/entrega).
        const esCantera =
          this.selectedPedido!.tipo_entrega === 'CANTERA' ||
          this.selectedPedido!.lugar_entrega === 'CANTERA';

        const res = await this.supabase
          .from('despachos_viajes_cabecera')
          .insert({
            pedido_id: this.selectedPedido!.id,
            despachador_id: user?.id,
            placa_vehiculo: this.viajeForm.placa?.trim().toUpperCase(),
            numero_viaje_secuencial: secIntent,
            estado_viaje: esCantera ? 'ENTREGADO' : 'ASIGNADO',
            lugar_entrega: this.selectedPedido!.lugar_entrega || null,
            latitud: this.viajeForm.lat,
            longitud: this.viajeForm.lng,
            fotos_urls: fotosUrls
          })
          .select()
          .single();

        cabeceraData = res.data;
        insertError = res.error;
        // 23505 = unique_violation: otro despachador insertó la misma secuencia
        if (insertError && (insertError as any).code === '23505' && !cabeceraData) {
          insertError = null;
          continue;
        }
      }

      if (insertError && !cabeceraData) throw insertError;

      // 3. Insertar Detalles
      const detallesAInsertar = this.viajeForm.items
        .filter(i => i.cantidad_viaje > 0)
        .map(i => {
          // Clamp defensivo al pendiente real del ítem: evita insertar un
          // sobrante de punto flotante (p.ej. 0.0000000000000004) que excedería
          // la cantidad pedida y bloquearía el siguiente despacho.
          const cantidad = Math.max(0, Math.min(
            this.round3(Number(i.cantidad_viaje) || 0),
            i.maxCantidad || 0
          ));
          return {
            viaje_id: cabeceraData.id,
            pedido_item_id: i.id,
            cantidad_viaje: cantidad
          };
        })
        .filter(d => d.cantidad_viaje > 0);

      if (detallesAInsertar.length > 0) {
        const { error: detalleError } = await this.supabase
          .from('despachos_viajes_detalle')
          .insert(detallesAInsertar);
          
        if (detalleError) throw detalleError;
      }

      // Mostramos el QR generado
      // Reconstruimos los detalles guardados para enviarlos al generador QR
      const detallesGenerados = detallesAInsertar.map((d, index) => {
        const matchedItem = this.viajeForm.items.find(i => i.id === d.pedido_item_id);
        return {
          id: 'temp-' + index, // no estrictamente necesario para el movil si no lo lee
          pedido_item_id: d.pedido_item_id,
          cantidad_viaje: d.cantidad_viaje,
          descripcion: matchedItem?.descripcion,
          unidad_medida: matchedItem?.unidad_medida
        };
      });
      
      this.qrPayload = this.generarPayloadQR(cabeceraData, detallesGenerados);
      this.displayQrModal = true; // Mostramos el QR!

      this.displayViajeModal = false;
      
      // Refrescar los ítems del pedido y la lista de pedidos
      delete this.itemsDelPedidoMap[this.selectedPedido!.id];
      await this.cargarItemsPedido(this.selectedPedido!.id);
      await this.cargarPedidos();

    } catch (error: any) {
      alert("Error al registrar el viaje: " + error.message);
    } finally {
      this.isSavingViaje = false;
    }
  }

  // ─── Caché local (offline-first) para el modal de ruta ─────────────────────
  // Guarda la última instantánea conocida de la auditoría para que la información
  // NO dependa de que el chofer (o el despachador) tenga internet: si una consulta
  // falla o el modal se reabre sin conexión, se reconstruye la vista con lo último
  // obtenido en lugar de mostrar "Mapa Vacío" / "Sin Viajes".

  private cacheKeyRuta(): string {
    return 'wm_ruta_cache_' + (this.selectedPedidoParaRuta?.id || '');
  }

  private guardarCacheRuta() {
    if (!this.selectedPedidoParaRuta) return;
    try {
      const snapshot = {
        puntosRuta: this.puntosRuta,
        entregasRuta: this.entregasRuta,
        viajesAuditoria: this.viajesAuditoria.map(v => ({
          numero_viaje_secuencial: v.numero_viaje_secuencial,
          despacho: v.despacho || null,
          chofer: v.chofer || null,
          mapaColor: v.mapaColor || null,
          mapaPuntos: v.mapaPuntos || [],
          gpsPuntos: v.gpsPuntos || [],
          eventosTimeline: v.eventosTimeline || []
        })),
        historialTracking: this.historialTracking,
        guardadoEn: Date.now()
      };
      localStorage.setItem(this.cacheKeyRuta(), JSON.stringify(snapshot));
    } catch (e) {
      // Cuota llena u otro error: el caché es opcional, nunca bloquear el flujo.
      console.warn('[Logistica] No se pudo guardar el caché de la ruta:', e);
    }
  }

  private cargarCacheRuta(): boolean {
    if (!this.selectedPedidoParaRuta) return false;
    try {
      const raw = localStorage.getItem(this.cacheKeyRuta());
      if (!raw) return false;
      const snap = JSON.parse(raw);
      if (!snap || !Array.isArray(snap.viajesAuditoria) || snap.viajesAuditoria.length === 0) return false;

      this.puntosRuta = Array.isArray(snap.puntosRuta) ? snap.puntosRuta : [];
      this.entregasRuta = Array.isArray(snap.entregasRuta) ? snap.entregasRuta : [];
      this.viajesAuditoria = snap.viajesAuditoria;

      // JSON convierte las fechas en strings; normalizar para que el ordenamiento
      // y el cálculo de ETA funcionen (necesitan objetos Date reales).
      this.historialTracking = (snap.historialTracking || []).map((h: any) => ({
        ...h,
        timestamp: h.timestamp ? new Date(h.timestamp) : h.timestamp
      }));
      this.viajesAuditoria.forEach(v => {
        if (v?.gpsPuntos) {
          v.gpsPuntos.forEach((p: any) => { if (p?.timestamp) p.timestamp = new Date(p.timestamp); });
        }
      });

      return true;
    } catch (e) {
      console.warn('[Logistica] No se pudo restaurar el caché de la ruta:', e);
      return false;
    }
  }

  async abrirRutaChofer(pedido: any) {
    this.selectedPedidoParaRuta = pedido;
    this.displayRutaModal = true;
    this.loadingRuta = true;
    this.puntosRuta = [];
    this.entregasRuta = [];
    this.viajesAuditoria = [];
    this.expandedViajeMap = {};
    this.mapFocus = null;

    // OFFLINE-FIRST: restaurar el último estado conocido de este pedido desde el
    // caché local para que el mapa y el historial nunca aparezcan vacíos mientras
    // se carga, ni si la red del despachador o del chofer está caída.
    this.cargarCacheRuta();
    this.viajesAuditoria.forEach((v, idx) => {
      if (this.expandedViajeMap[v.numero_viaje_secuencial] === undefined) {
        this.expandedViajeMap[v.numero_viaje_secuencial] = (idx === 0);
      }
    });

    // PREVENCIÓN DE FUGAS DE MEMORIA: Limpiar subscripciones e intervalos previos si los hubiese
    if (this.rutaRealtimeChannel) {
      this.supabase.removeChannel(this.rutaRealtimeChannel);
      this.rutaRealtimeChannel = null;
    }
    if (this.rutaPollingInterval) {
      clearInterval(this.rutaPollingInterval);
      this.rutaPollingInterval = null;
    }

    // Limpiar el mapa actual si existe
    if (this.map) {
      this.map.remove();
      this.map = null;
    }

    // Suscribir a cambios en tiempo real para este pedido
    this.rutaRealtimeChannel = this.supabase.channel('current-ruta-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'despachos_viajes_cabecera' }, payload => {
        const item = (payload.new || payload.old) as any;
        if (this.selectedPedidoParaRuta && item && item.pedido_id === this.selectedPedidoParaRuta.id) {
          this.ngZone.run(async () => {
            await this.refrescarDatosRuta();
          });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rutas_gps' }, payload => {
        const item = (payload.new || payload.old) as any;
        if (this.selectedPedidoParaRuta && item && item.pedido_id === this.selectedPedidoParaRuta.id) {
          this.ngZone.run(async () => {
            await this.refrescarDatosRuta();
          });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'viajes_entregas' }, payload => {
        const item = (payload.new || payload.old) as any;
        if (this.selectedPedidoParaRuta && item && item.pedido_id === this.selectedPedidoParaRuta.id) {
          this.ngZone.run(async () => {
            await this.refrescarDatosRuta();
          });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sesiones_gps' }, payload => {
        const item = (payload.new || payload.old) as any;
        if (this.selectedPedidoParaRuta && item && item.pedido_id === this.selectedPedidoParaRuta.id) {
          this.ngZone.run(async () => {
            await this.refrescarDatosRuta();
          });
        }
      })
      .subscribe();

    // Polling Híbrido de Respaldo cada 12 segundos para asegurar actualización
    // en redes inestables o si la replicación de Supabase Realtime no está activa.
    this.rutaPollingInterval = setInterval(() => {
      if (this.selectedPedidoParaRuta && this.displayRutaModal) {
        this.ngZone.run(async () => {
          await this.refrescarDatosRuta();
        });
      }
    }, 12000);

    await this.refrescarDatosRuta();
    this.loadingRuta = false;
  }

  async refrescarDatosRuta() {
    if (!this.selectedPedidoParaRuta) return;

    // ────────────────────────────────────────────────────────────────────────
    // OFFLINE-FIRST: cada consulta maneja su propio error. Si una fuente falla
    // (red intermitente del despachador o del chofer), se conserva el último
    // estado conocido en memoria y en el caché local en lugar de tratarla como
    // "no hay datos". Antes, un error de red devolvía `data: null` y eso borraba
    // el icono del camión en vivo y el historial de viajes del modal.
    // ────────────────────────────────────────────────────────────────────────
    let despachosData: any[] | null = null;
    let gpsData: any[] | null = null;
    let entregasData: any[] | null = null;

    try {
      // 1. Obtener datos del Despacho (Salidas desde la Planta)
      const rDespachos = await this.supabase
        .from('despachos_viajes_cabecera')
        .select(`
          *,
          usuarios:usuarios!despachos_viajes_cabecera_despachador_id_fkey (correo, nombre_completo),
          chofer_cabecera:usuarios!despachos_viajes_cabecera_chofer_id_fkey (nombre_completo),
          despachos_viajes_detalle (
            cantidad_viaje,
            pedidos_items (
              productos(descripcion, unidad_medida),
              descripcion_manual,
              unidad_medida_manual
            )
          )
        `)
        .eq('pedido_id', this.selectedPedidoParaRuta.id)
        .order('numero_viaje_secuencial', { ascending: true });

      if (rDespachos.error) {
        console.warn('[Logistica] Error al obtener despachos (se conservan los últimos conocidos):', rDespachos.error);
      } else {
        despachosData = rDespachos.data;
      }

      // 2. Obtener puntos GPS del chofer (consultar TODOS los del pedido, porque offline pueden no tener sesion_id)
      const rGps = await this.supabase
          .from('rutas_gps')
          .select('*')
          .eq('pedido_id', this.selectedPedidoParaRuta.id)
          .order('timestamp', { ascending: true });

      if (rGps.error) {
        console.warn('[Logistica] Error al obtener GPS (se conserva la última ruta conocida):', rGps.error);
      } else {
        gpsData = rGps.data;
        // Solo reemplazar la ruta si la consulta tuvo éxito (no en errores de red)
        this.puntosRuta = (gpsData || []).filter(p => p.latitud && p.longitud && p.latitud !== 0 && p.longitud !== 0);
      }

      // 3. Obtener entregas del chofer (Llegadas al cliente)
      const rEntregas = await this.supabase
        .from('viajes_entregas')
        .select('*, chofer:usuarios(nombre_completo)')
        .eq('pedido_id', this.selectedPedidoParaRuta.id)
        .order('created_at', { ascending: true });

      if (rEntregas.error) {
        console.warn('[Logistica] Error al obtener entregas (se conservan las últimas conocidas):', rEntregas.error);
      } else {
        entregasData = rEntregas.data;
        this.entregasRuta = (entregasData || []).filter(e => e.latitud && e.longitud && e.latitud !== 0 && e.longitud !== 0);
      }
    } catch (e: any) {
      // Error inesperado (p. ej. red caída): NO borrar nada. Seguimos mostrando
      // el mapa, el camión en vivo y el historial con lo último conocido.
      console.warn('[Logistica] Error al refrescar datos de ruta (se reintentará):', e);
    }

    // Si no se pudo obtener NINGUNA fuente, no hay nada nuevo que consolidar:
    // mantener el estado actual (memoria + caché) y seguir actualizando el
    // marcador vivo y el ETA con la última posición conocida.
    if (despachosData === null && gpsData === null && entregasData === null) {
      setTimeout(() => {
        this.initBaseMap();
        this.renderMap(!this.mapInitialBoundsDone);
      }, 300);
      this.calcularETAActual();
      return;
    }

    try {
      // 4. Consolidar para Auditoría visual (Tarjetas)
      const consolidadosMap = new Map<number, any>();

      // Registrar despachos (solo si la consulta fue exitosa; si falló, reutilizar
      // los despachos en memoria para no perder el historial ni el estado EN RUTA
      // que mantiene vivo el marcador del camión).
      if (despachosData !== null) {
        (despachosData || []).forEach(d => {
          const num = d.numero_viaje_secuencial || 1;
          consolidadosMap.set(num, { numero_viaje_secuencial: num, despacho: d, chofer: null });
        });
      } else {
        this.viajesAuditoria.forEach(v => {
          if (v?.despacho) {
            consolidadosMap.set(v.numero_viaje_secuencial, {
              numero_viaje_secuencial: v.numero_viaje_secuencial,
              despacho: v.despacho,
              chofer: v.chofer || null
            });
          }
        });
      }

      // Registrar entregas (solo si la consulta fue exitosa; si falló, conservar
      // las entregas en memoria para no perder el historial).
      if (entregasData !== null) {
        (entregasData || []).forEach(c => {
          const num = c.numero_viaje_secuencial || 1;
          if (consolidadosMap.has(num)) {
            consolidadosMap.get(num).chofer = c;
          } else {
            consolidadosMap.set(num, { numero_viaje_secuencial: num, despacho: null, chofer: c });
          }
        });
      } else {
        this.viajesAuditoria.forEach(v => {
          if (v?.chofer) {
            const num = v.numero_viaje_secuencial;
            if (consolidadosMap.has(num)) {
              consolidadosMap.get(num).chofer = v.chofer;
            } else {
              consolidadosMap.set(num, { numero_viaje_secuencial: num, despacho: null, chofer: v.chofer });
            }
          }
        });
      }

      // Incorporar viajes que solo tengan puntos GPS pero ningún despacho ni entrega aún en la nube (flujo en progreso)
      (this.puntosRuta || []).forEach(p => {
        const num = p.numero_viaje_secuencial || 1;
        if (!consolidadosMap.has(num)) {
          consolidadosMap.set(num, { numero_viaje_secuencial: num, despacho: null, chofer: null });
        }
      });

      // 5. Construir Historial Unificado para la línea de tiempo y colores
      this.historialTracking = [];
      const TRAMO_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#06b6d4', '#ec4899'];

      const newViajes = Array.from(consolidadosMap.values())
        .sort((a, b) => b.numero_viaje_secuencial - a.numero_viaje_secuencial);

      // Color consistente por secuencial (basado en el orden ASCENDENTE) para que
      // coincidan el timeline, las tarjetas y el mapa en cualquier vista.
      const colorPorSecuencial = new Map<number, string>();
      [...newViajes]
        .sort((a, b) => a.numero_viaje_secuencial - b.numero_viaje_secuencial)
        .forEach((v, i) => colorPorSecuencial.set(v.numero_viaje_secuencial, TRAMO_COLORS[i % TRAMO_COLORS.length]));

      // Agrupamos por Secuencial de Viaje para poder trazar un polyline por cada viaje
      for (const aud of newViajes) {
        const seqNum = aud.numero_viaje_secuencial;
        const colorTramo = colorPorSecuencial.get(seqNum) || TRAMO_COLORS[0];
        const puntosDelViaje: L.LatLngTuple[] = [];

        // 5a. Añadir evento de Despacho (Si tiene coords)
        if (aud.despacho && aud.despacho.latitud && aud.despacho.longitud) {
          puntosDelViaje.push([aud.despacho.latitud, aud.despacho.longitud]);
          this.historialTracking.push({
            type: 'DESPACHO',
            lat: aud.despacho.latitud,
            lng: aud.despacho.longitud,
            timestamp: new Date(aud.despacho.created_at),
            title: `Viaje #${seqNum} Despachado por ${aud.despacho.usuarios?.nombre_completo || 'Despachador'}`,
            icon: 'pi pi-truck',
            color: 'text-purple-500',
            bg: 'bg-purple-100',
            tramoColor: colorTramo
          });
        }

        // 5b. Añadir evento de Recepción (Si tiene coords independientes)
        if (aud.despacho && aud.despacho.latitud_recepcion && aud.despacho.longitud_recepcion) {
          puntosDelViaje.push([aud.despacho.latitud_recepcion, aud.despacho.longitud_recepcion]);
          this.historialTracking.push({
            type: 'RECEPCION',
            lat: aud.despacho.latitud_recepcion,
            lng: aud.despacho.longitud_recepcion,
            timestamp: new Date(aud.despacho.fecha_recepcion_chofer || aud.despacho.created_at),
            title: `Viaje #${seqNum} Recepcionado por ${aud.despacho.chofer_cabecera?.nombre_completo || 'Chofer'}`,
            icon: 'pi pi-check-circle',
            color: 'text-orange-500',
            bg: 'bg-orange-100',
            tramoColor: colorTramo
          });
        }

        // 5c. Puntos GPS del viaje, con corte temporal en el punto de entrega.
        const soloUnViaje = (despachosData || []).length <= 1;

        // En pedidos multi-viaje los puntos sin numero_viaje_secuencial no se
        // pueden atribuir a un viaje ya entregado; se asignan al viaje EN CURSO
        // (EN RUTA / ASIGNADO), que es el que genera GPS ahora mismo.
        const viajeActivoSeq = (despachosData || [])
          .find(d => d.estado_viaje === 'EN RUTA' || d.estado_viaje === 'ASIGNADO')
          ?.numero_viaje_secuencial ?? null;
        const esViajeActivo = viajeActivoSeq !== null && seqNum === viajeActivoSeq;

        // Usamos fecha_dispositivo (reloj del teléfono) con fallback a created_at (reloj del servidor).
        const entregaTs = aud.chofer
          ? new Date(aud.chofer.fecha_dispositivo || aud.chofer.created_at).getTime()
          : null;

        const gpsDeEsteViaje = this.puntosRuta.filter(p => {
          const perteneceAEsteViaje =
            p.numero_viaje_secuencial === seqNum ||
            (soloUnViaje && (p.numero_viaje_secuencial === null || p.numero_viaje_secuencial === undefined)) ||
            (esViajeActivo && (p.numero_viaje_secuencial === null || p.numero_viaje_secuencial === undefined));

          if (!perteneceAEsteViaje) return false;

          if (entregaTs) {
            if (!p.timestamp) return false;
            return new Date(p.timestamp).getTime() <= entregaTs;
          }

          return true;
        });

        aud.gpsPuntos = gpsDeEsteViaje;




        gpsDeEsteViaje.forEach(p => {
          puntosDelViaje.push([p.latitud, p.longitud]);
        });

        // 5d. Añadir evento de Entrega
        if (aud.chofer && aud.chofer.latitud && aud.chofer.longitud) {
          puntosDelViaje.push([aud.chofer.latitud, aud.chofer.longitud]);
          this.historialTracking.push({
            type: 'ENTREGA',
            lat: aud.chofer.latitud,
            lng: aud.chofer.longitud,
            timestamp: new Date(aud.chofer.fecha_dispositivo || aud.chofer.created_at),
            title: `Viaje #${seqNum} Entregado por ${aud.chofer.chofer?.nombre_completo || 'Chofer'}`,
            icon: 'pi pi-check-circle',
            color: 'text-green-500',
            bg: 'bg-green-100',
            tramoColor: colorTramo
          });
        }

        aud.mapaPuntos = puntosDelViaje;
        aud.mapaColor = colorTramo;

        // Precalcular eventos de timeline una sola vez por merge (evita recalcular
        // en cada detección de cambios del *ngFor del template).
        aud.eventosTimeline = this.getTimelineEvents(aud);
      }

      // Ordenar la línea de tiempo de manera DECRECIENTE (más recientes primero)
      this.historialTracking.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      // MERGE NO DESTRUCTIVO: actualizar viajesAuditoria en memoria sin reemplazar el array completo.
      // Esto previene que el *ngFor en el HTML destruya y reconstruya las tarjetas,
      // lo que causaba el parpadeo de "Sin registro de despacho" durante las actualizaciones.
      if (this.viajesAuditoria.length === 0) {
        this.viajesAuditoria = newViajes;
      } else {
        // Sincronización bidireccional: eliminar viajes que ya no existen en la
        // fuente (p. ej. un borrado hecho en la app móvil).
        const seqsFuente = new Set(newViajes.map(v => v.numero_viaje_secuencial));
        this.viajesAuditoria = this.viajesAuditoria.filter(v => seqsFuente.has(v.numero_viaje_secuencial));

        // Actualizar propiedades de los objetos existentes (sin reemplazar referencias de objeto)
        newViajes.forEach(newV => {
          const existingIdx = this.viajesAuditoria.findIndex(v => v.numero_viaje_secuencial === newV.numero_viaje_secuencial);
          if (existingIdx >= 0) {
            Object.assign(this.viajesAuditoria[existingIdx], newV);
          } else {
            // Nuevo viaje detectado: insertar al principio (orden decreciente)
            this.viajesAuditoria.unshift(newV);
          }
        });
      }

      // Guardar instantánea local (offline-first): permite reconstruir el mapa y
      // el historial aunque la red del despachador o del chofer esté caída.
      this.guardarCacheRuta();

      // Abrir el primer viaje expandido si aún no hay ninguno abierto
      this.viajesAuditoria.forEach((v, idx) => {
        if (this.expandedViajeMap[v.numero_viaje_secuencial] === undefined) {
          this.expandedViajeMap[v.numero_viaje_secuencial] = (idx === 0);
        }
      });

      // Fallback: si rutas_gps no tiene datos recientes, usar el último punto
      // conocido directamente desde rutas_gps filtrando por chofer_id.
      // Se ejecuta ANTES de renderizar para que el marcador vivo y el ETA lo incluyan.
      const hayGpsReciente = this.puntosRuta.length > 0 && (() => {
        const sorted = [...this.puntosRuta].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        return Date.now() - new Date(sorted[0]?.timestamp).getTime() <= 180000;
      })();
      if (!hayGpsReciente) {
        const viajeActivo = this.viajeEnCurso();
        if (viajeActivo?.despacho?.chofer_id) {
          // Usar rutas_gps (tabla correcta) en lugar de gps_tracking (no existe)
          const { data: gpsLive } = await this.supabase
            .from('rutas_gps')
            .select('latitud, longitud, timestamp')
            .eq('chofer_id', viajeActivo.despacho.chofer_id)
            .order('timestamp', { ascending: false })
            .limit(1);
          if (gpsLive && gpsLive.length > 0) {
            const g = gpsLive[0];
            const edadMs = Date.now() - new Date(g.timestamp).getTime();
            if (edadMs < 180000) {
              this.puntosRuta = [
                {
                  latitud: g.latitud,
                  longitud: g.longitud,
                  timestamp: g.timestamp,
                  numero_viaje_secuencial: viajeActivo.despacho.numero_viaje_secuencial
                } as any,
                ...this.puntosRuta
              ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            }
          }
        }
      }

      // Renderizar el mapa de Leaflet (después del fallback para incluir el punto vivo)
      setTimeout(() => {
        this.initBaseMap();              // Inicializa tile layer + grupos si es la primera vez
        const esPrimeraCarga = !this.mapInitialBoundsDone;
        this.renderMap(esPrimeraCarga); // fitBounds solo en la primera carga
      }, 300);

      // Calcular ETA una vez que puntosRuta y selectedPedidoParaRuta están listos
      this.calcularETAActual();

    } catch (e) {
      // Silencioso en el polling: no alertar al usuario por errores de red temporales
      console.warn('[Logistica] Error al refrescar datos de ruta (se reintentará):', e);
    }
  }

  // OSRM eliminado para graficar los puntos GPS reales (camino de puntos) sin "vueltones"
  /** Inicializa el mapa base (tile layer + layer groups) una sola vez. */
  initBaseMap() {
    const container = document.getElementById('ruta-mapa-unificado');
    if (!container) return;

    if (this.map) {
      // Ya existe: solo refrescar tamaño
      setTimeout(() => this.map?.invalidateSize(), 100);
      return;
    }

    const isDark = document.body.classList.contains('dark-mode') ||
                   document.documentElement.getAttribute('data-theme') === 'dark' ||
                   document.body.getAttribute('data-theme') === 'dark';

    this.map = L.map(container, { zoomControl: true, maxZoom: 19 });

    const defaultLayer = L.tileLayer(
      isDark
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      { attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 20 }
    );

    const sateliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '© Esri',
      maxZoom: 19
    });

    const terrenoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors, SRTM | map style: © OpenTopoMap (CC-BY-SA)',
      maxZoom: 17
    });

    defaultLayer.addTo(this.map);

    const baseMaps = {
      "Mapa Estándar": defaultLayer,
      "Satélite": sateliteLayer,
      "Relieve / Terreno": terrenoLayer
    };

    L.control.layers(baseMaps, undefined, { position: 'bottomright' }).addTo(this.map);

    // Grupos de capas reutilizables
    this.layerGroupTramos     = L.layerGroup().addTo(this.map);
    this.layerGroupMarcadores = L.layerGroup().addTo(this.map);
    this.layerGroupVivo       = L.layerGroup().addTo(this.map);

    setTimeout(() => this.map?.invalidateSize(), 100);
  }


  // ─── Redibuja el mapa según el estado actual de mapFocus ─────────────────────
  // Este método es la ÚNICA puerta de entrada para cambiar lo que se muestra.
  // El polling lo llama sin fitBounds; los botones lo llaman con fitBounds=true.
  renderMap(applyFitBounds: boolean = false) {
    if (!this.map) return;

    const TRAMO_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#06b6d4', '#ec4899', '#f97316', '#14b8a6'];

    // Limpiar grupos de datos (nunca se toca el tile layer ni el grupo de vivo)
    this.layerGroupTramos?.clearLayers();
    this.layerGroupMarcadores?.clearLayers();

    const bounds = L.latLngBounds([]);
    let pointsAdded = 0;

    // ─── Helper: marcador circular numerado ──────────────────────────────────
    const circulo = (latlng: L.LatLngTuple, num: number, bg: string, size = 28) => {
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:${bg};color:#fff;width:${size}px;height:${size}px;
               display:flex;align-items:center;justify-content:center;border-radius:50%;
               border:2.5px solid rgba(255,255,255,0.9);font-weight:700;
               font-size:${Math.round(size * 0.42)}px;
               box-shadow:0 2px 8px rgba(0,0,0,0.4);line-height:1;">${num}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -(size / 2) - 4]
      });
      return L.marker(latlng, { icon });
    };

    // ── CASO 1: Foco en un PUNTO del despachador ────────────────────────────
    if (this.mapFocus?.type === 'punto') {
      const { lat, lng, label } = this.mapFocus;
      const latlng: L.LatLngTuple = [lat, lng];

      // Solo un marcador morado grande con número del viaje no aplica,
      // aquí es el punto exacto del despachador ya que no hay número de viaje en este contexto
      const iconPunto = L.divIcon({
        className: '',
        html: `<div style="background:#7c3aed;color:#fff;width:36px;height:36px;
               display:flex;align-items:center;justify-content:center;border-radius:50%;
               border:3px solid rgba(255,255,255,0.95);
               box-shadow:0 3px 12px rgba(124,58,237,0.55);font-size:1.2rem;">📍</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -20]
      });

      L.marker(latlng, { icon: iconPunto })
        .bindPopup(`<b>🟣 ${label}</b>`, { autoClose: false })
        .openPopup()
        .addTo(this.layerGroupMarcadores!);

      bounds.extend(latlng);
      pointsAdded++;

    // ── CASO 2: Foco en la RUTA de un viaje específico ─────────────────────
    // Muestra en una sola vista: punto de despacho + trazo GPS + punto de entrega
    } else if (this.mapFocus?.type === 'ruta') {
      // Buscar el viajeItem actualizado por numero_viaje_secuencial (no por referencia)
      const focusSeq = (this.mapFocus as any).viajeSeq as number;
      const aud = this.viajesAuditoria.find(v => v.numero_viaje_secuencial === focusSeq);
      if (!aud) {
        // El viaje ya no existe, limpiar foco
        this.mapFocus = null;
      } else {
        const numViaje = aud.numero_viaje_secuencial;
        const color = aud.mapaColor || TRAMO_COLORS[(numViaje - 1) % TRAMO_COLORS.length];

        // Punto de despacho (origen, morado)
        if (aud.despacho?.latitud && aud.despacho?.longitud) {
          const pd: L.LatLngTuple = [aud.despacho.latitud, aud.despacho.longitud];
          const iconDespacho = L.divIcon({
            className: '',
            html: `<div style="background:#7c3aed;color:#fff;width:32px;height:32px;
                   display:flex;align-items:center;justify-content:center;border-radius:50%;
                   border:2.5px solid rgba(255,255,255,0.9);font-size:1.1rem;
                   box-shadow:0 2px 8px rgba(124,58,237,0.5);">📍</div>`,
            iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -18]
          });
          L.marker(pd, { icon: iconDespacho })
            .bindPopup(`<b>🟣 Punto de Despacho (Planta)</b><br>${aud.despacho.usuarios?.nombre_completo || 'Despachador'}`)
            .addTo(this.layerGroupMarcadores!);
          bounds.extend(pd);
          pointsAdded++;
        }

        const gps: L.LatLngTuple[] = (aud.gpsPuntos || []).map((p: any) => [p.latitud, p.longitud] as L.LatLngTuple);

        // Trazo GPS en tiempo real
        if (gps.length >= 2) {
          L.polyline(gps, { color, weight: 5, opacity: 0.95 }).addTo(this.layerGroupTramos!);
          gps.forEach(p => { bounds.extend(p); pointsAdded++; });
        }

        // Marcador de inicio de GPS (verde)
        if (gps.length > 0) {
          circulo(gps[0], numViaje, '#16a34a', 30)
            .bindPopup(`<b>🟢 Inicio Trayecto #${numViaje}</b>`)
            .addTo(this.layerGroupMarcadores!);
          bounds.extend(gps[0]);
          pointsAdded++;
        }

        // Punto de entrega registrado (rojo, si ya fue registrada)
        if (aud.chofer?.latitud && aud.chofer?.longitud) {
          const fin: L.LatLngTuple = [aud.chofer.latitud, aud.chofer.longitud];
          circulo(fin, numViaje, '#dc2626', 30)
            .bindPopup(`<b>🔴 Punto de Entrega #${numViaje}</b><br>${aud.chofer.chofer?.nombre_completo || 'Chofer'}`)
            .addTo(this.layerGroupMarcadores!);
          bounds.extend(fin);
          pointsAdded++;
        }

        // Marcador de destino objetivo 🎯 (guardado al convertir la cotización)
        const pedidoDest = this.selectedPedidoParaRuta as any;
        if (pedidoDest?.lat_destino && pedidoDest?.lng_destino) {
          const dest: L.LatLngTuple = [pedidoDest.lat_destino, pedidoDest.lng_destino];
          const iconDestino = L.divIcon({
            className: '',
            html: `<div style="background:#2563eb;color:#fff;width:36px;height:36px;
                   display:flex;align-items:center;justify-content:center;border-radius:50%;
                   border:3px solid #fff;font-size:1.2rem;
                   box-shadow:0 2px 12px rgba(37,99,235,0.7);">🎯</div>`,
            iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -22]
          });
          L.marker(dest, { icon: iconDestino })
            .bindPopup(`<b>🎯 Destino de Entrega</b><br>${pedidoDest.direccion_entrega_detalle || 'Coordenadas registradas'}`)
            .addTo(this.layerGroupMarcadores!);
          bounds.extend(dest);
          pointsAdded++;
        }
      }

    // ── CASO 3: Vista general (todos los viajes) ────────────────────────────
    } else {
      const viajes = [...this.viajesAuditoria].sort((a, b) => a.numero_viaje_secuencial - b.numero_viaje_secuencial);

      for (let idx = 0; idx < viajes.length; idx++) {
        const aud = viajes[idx];
        const color = aud.mapaColor || TRAMO_COLORS[idx % TRAMO_COLORS.length];
        const num = aud.numero_viaje_secuencial;

        const gps: L.LatLngTuple[] = (aud.gpsPuntos || []).map((p: any) => [p.latitud, p.longitud] as L.LatLngTuple);

        if (gps.length >= 2) {
          L.polyline(gps, { color, weight: 4, opacity: 0.9 }).addTo(this.layerGroupTramos!);
          gps.forEach(p => { bounds.extend(p); pointsAdded++; });
        }

        if (gps.length > 0) {
          circulo(gps[0], num, '#16a34a', 28)
            .bindPopup(`<b>🟢 Inicio Viaje #${num}</b>`)
            .addTo(this.layerGroupMarcadores!);
          bounds.extend(gps[0]);
          pointsAdded++;
        }

        if (aud.chofer?.latitud && aud.chofer?.longitud) {
          const fin: L.LatLngTuple = [aud.chofer.latitud, aud.chofer.longitud];
          circulo(fin, num, '#dc2626', 28)
            .bindPopup(`<b>🔴 Fin Viaje #${num}</b>`)
            .addTo(this.layerGroupMarcadores!);
          bounds.extend(fin);
          pointsAdded++;
        }

        if (aud.despacho?.latitud && aud.despacho?.longitud) {
          const pd: L.LatLngTuple = [aud.despacho.latitud, aud.despacho.longitud];
          circulo(pd, num, '#7c3aed', 24)
            .bindPopup(`<b>🟣 Despacho #${num}</b><br>${aud.despacho.usuarios?.nombre_completo || 'Despachador'}`)
            .addTo(this.layerGroupMarcadores!);
          bounds.extend(pd);
          pointsAdded++;
        }
      }

      // Destino 🎯 siempre visible en la vista general (si el pedido tiene coordenadas)
      const pedidoDestGen = this.selectedPedidoParaRuta as any;
      if (pedidoDestGen?.lat_destino && pedidoDestGen?.lng_destino) {
        const dest: L.LatLngTuple = [pedidoDestGen.lat_destino, pedidoDestGen.lng_destino];
        const iconDestinoGen = L.divIcon({
          className: '',
          html: `<div style="background:#2563eb;color:#fff;width:36px;height:36px;
                 display:flex;align-items:center;justify-content:center;border-radius:50%;
                 border:3px solid #fff;font-size:1.2rem;
                 box-shadow:0 2px 12px rgba(37,99,235,0.7);">🎯</div>`,
          iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -22]
        });
        L.marker(dest, { icon: iconDestinoGen })
          .bindPopup(`<b>🎯 Destino de Entrega</b><br>${pedidoDestGen.direccion_entrega_detalle || 'Coordenadas registradas'}`)
          .addTo(this.layerGroupMarcadores!);
        bounds.extend(dest);
        pointsAdded++;
      }
    }

    // ── Marcador vivo del camión: visible solo si hay un viaje EN CURSO ──
    // (EN RUTA/ASIGNADO) y GPS reciente. Evita mostrar el camión "en vivo"
    // cuando el pedido ya fue entregado o cuando el último punto GPS pertenece
    // a un viaje anterior ya finalizado.
    const viajeActivoVivo = this.viajeEnCurso();
    // 'ENTREGADA' no existe como estado de pedido: solo 'COMPLETADA'.
    const pedidoTerminado = this.selectedPedidoParaRuta?.estado === 'COMPLETADA';
    const gpsVivo = (viajeActivoVivo?.gpsPuntos && viajeActivoVivo.gpsPuntos.length)
      ? viajeActivoVivo.gpsPuntos
      : this.puntosRuta;

    if (viajeActivoVivo && !pedidoTerminado && gpsVivo.length > 0) {
      const sorted = [...gpsVivo].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      const ultimo  = sorted[0];
      const edadMs  = Date.now() - new Date(ultimo.timestamp).getTime();
      const edadMin = edadMs / 60000;

        const lv: L.LatLngTuple = [ultimo.latitud, ultimo.longitud];

      // Determinar estado: sin señal / detenido / en movimiento
      let markerState: 'moving' | 'stopped' | 'no_signal';
      if (edadMin >= 5) {
        markerState = 'no_signal';
      } else if (sorted.length >= 2) {
        const prev = sorted[1];
        const d = this.haversineKm(prev.latitud, prev.longitud, ultimo.latitud, ultimo.longitud);
        const t = (new Date(ultimo.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 3_600_000;
        const vel = t > 0 ? d / t : 0;
        markerState = vel < 3 ? 'stopped' : 'moving';
      } else {
        markerState = 'moving';
      }

      const icon = buildLiveTruckIcon(markerState, edadMin);
      const popupText = markerState === 'moving'
        ? '🚛 Chofer en movimiento'
        : markerState === 'stopped'
        ? `⏸ Chofer detenido · ${Math.round(edadMin)} min sin desplazamiento`
        : `📡 Sin señal GPS · última posición hace ${Math.round(edadMin)} min`;

      if (this.liveMarker) {
        this.liveMarker.setLatLng(lv);
        this.liveMarker.setIcon(icon);
        this.liveMarker.setPopupContent(popupText);
        if (!this.map!.hasLayer(this.liveMarker)) {
          this.liveMarker.addTo(this.layerGroupVivo!);
        }
      } else {
        this.liveMarker = L.marker(lv, { icon, zIndexOffset: 1000 })
          .bindPopup(popupText)
          .addTo(this.layerGroupVivo!);
      }
    } else if (this.liveMarker) {
      this.layerGroupVivo?.removeLayer(this.liveMarker);
      this.liveMarker = null;
    }

    // ── fitBounds: solo cuando se solicita explícitamente ────────────────────
    if (applyFitBounds) {
      if (pointsAdded > 0 && bounds.isValid()) {
        this.map!.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
        // Solo marcar como inicializado cuando realmente se pudieron encuadrar datos
        this.mapInitialBoundsDone = true;
      } else if (!this.mapInitialBoundsDone) {
        // Sin datos todavía: centrar en Lima sin marcar como "ya inicializado",
        // para que el primer poll con datos reales sí haga el fitBounds.
        this.map!.setView([-12.046374, -77.042793], 13);
      }
    }
  }

  // ─── Acciones de foco ─────────────────────────────────────────────────────

  /**
   * Botón "Ver Ruta" de un viaje.
   * Muestra en una sola vista: punto de despacho + trazo GPS + punto de entrega.
   * Compara por numero_viaje_secuencial (no por referencia de objeto) para resistir
   * el re-render del array durante el polling.
   */
  enfocarEnViaje(viajeItem: any) {
    const seq = viajeItem.numero_viaje_secuencial;
    const esMismo = this.mapFocus?.type === 'ruta' && (this.mapFocus as any).viajeSeq === seq;
    this.mapFocus = esMismo ? null : { type: 'ruta', viajeItem, viajeSeq: seq } as any;
    this.renderMap(true);
  }

  /** Botón "Ver ubicación exacta" del despachador */
  enfocarEnPunto(lat: number, lng: number, label: string) {
    const esMismo = this.mapFocus?.type === 'punto'
      && (this.mapFocus as any).lat === lat
      && (this.mapFocus as any).lng === lng;
    this.mapFocus = esMismo ? null : { type: 'punto', lat, lng, label } as any;
    this.renderMap(true);
  }



  getTimelineEvents(viajeItem: any) {
    return [
      {
        status: 'Carga y Salida en Planta',
        date: viajeItem.despacho?.created_at,
        icon: 'pi pi-truck',
        color: '#7c3aed', // Morado
        data: viajeItem.despacho,
        type: 'carga'
      },
      {
        status: 'Confirmación del Chofer',
        date: viajeItem.despacho?.fecha_recepcion_chofer, 
        icon: 'pi pi-check-circle',
        color: viajeItem.despacho?.fecha_recepcion_chofer ? '#F59E0B' : '#d1d5db',
        data: viajeItem.despacho,
        type: 'confirmacion'
      },
      ...(viajeItem.gpsPuntos && viajeItem.gpsPuntos.length > 0 ? [{
        status: 'En ruta al destino',
        date: viajeItem.gpsPuntos[0].timestamp,
        icon: 'pi pi-map',
        color: '#3B82F6', // Azul
        data: { puntos: viajeItem.gpsPuntos },
        type: 'gps_ruta'
      }] : []),
      {
        status: 'Entrega en Obra',
        date: viajeItem.chofer?.fecha_dispositivo,
        icon: 'pi pi-map-marker',
        color: viajeItem.chofer ? '#10B981' : '#d1d5db',
        data: viajeItem.chofer,
        type: 'entrega'
      }
    ];
  }

  trackByViajeItem(index: number, viaje: any): number {
    return viaje.numero_viaje_secuencial;
  }

  trackByEventType(index: number, event: any): string {
    return event.type;
  }

  abrirImagen(url: string) {
    console.log('Abriendo imagen:', url);
    this.selectedImageUrl = url;
    this.displayImageModal = true;
  }

  cerrarRutaModal() {
    this.displayRutaModal = false;
    this.selectedPedidoParaRuta = null;
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    // Reset completo del estado del mapa
    this.layerGroupTramos     = null;
    this.layerGroupMarcadores = null;
    this.layerGroupVivo       = null;
    this.liveMarker           = null;
    this.mapFocus             = null;
    this.mapInitialBoundsDone = false;

    if (this.rutaRealtimeChannel) {
      this.supabase.removeChannel(this.rutaRealtimeChannel);
      this.rutaRealtimeChannel = null;
    }
    if (this.rutaPollingInterval) {
      clearInterval(this.rutaPollingInterval);
      this.rutaPollingInterval = null;
    }
  }

  abrirMapa(lat: number, lng: number) {
    // geo: es el estándar universal: en Android abre Google Maps y en iOS Apple Maps.
    // Evita el esquema http:// que algunos navegadores o bloqueadores de popups rechazan.
    window.open(`geo:${lat},${lng}`, '_blank');
  }

  abrirFoto(url: string) {
    window.open(url, '_blank');
  }

  // ─── Helpers para el template (evita errores de tipo con union discriminada) ─

  /** Compara por numero_viaje_secuencial (no por referencia) para resistir el re-render del array. */
  isFocusRuta(viajeItem: any): boolean {
    return this.mapFocus?.type === 'ruta' &&
      (this.mapFocus as any).viajeSeq === viajeItem.numero_viaje_secuencial;
  }

  isFocusPunto(lat: number, lng: number): boolean {
    return this.mapFocus?.type === 'punto'
      && (this.mapFocus as any).lat === lat
      && (this.mapFocus as any).lng === lng;
  }

  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Distancia en kilómetros entre dos coordenadas usando la fórmula de Haversine.
   */
  private haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Calcula el ETA estimado al punto de destino del pedido usando los últimos
   * puntos GPS disponibles para estimar la velocidad promedio del vehículo.
   * 
   * Si los datos GPS tienen más de 5 minutos de antigüedad (zona remota sin señal),
   * el resultado se marca como estimado basado en última posición conocida.
   */
  calcularETAActual(): void {
    if (!this.selectedPedidoParaRuta) {
      this.etaInfo = null;
      return;
    }

    // Pedidos CANTERA (recojo en planta): no hay traslado ni destino GPS.
    // El formulario comercial guarda lat_destino/lng_destino como null y el
    // aviso del modal ya indica "No requiere ruta GPS", así que el ETA no aplica.
    // Sin este guard, el fallback de "último punto de ENTREGA" usaba la propia
    // planta como destino y mostraba un ETA sin sentido (≈0 km).
    const esEntregaCantera =
      this.selectedPedidoParaRuta.tipo_entrega === 'CANTERA' ||
      this.selectedPedidoParaRuta.lugar_entrega === 'CANTERA';
    if (esEntregaCantera) {
      this.etaInfo = null;
      return;
    }

    // Bug 1: Si el pedido no tiene lat/lng guardados, intentar usar el último punto
    // de despacho del historial como aproximación del destino
    let latDestino = this.selectedPedidoParaRuta.lat_destino
      ? parseFloat(this.selectedPedidoParaRuta.lat_destino)
      : null;
    let lngDestino = this.selectedPedidoParaRuta.lng_destino
      ? parseFloat(this.selectedPedidoParaRuta.lng_destino)
      : null;

    if (!latDestino || !lngDestino) {
      // Intentar usar coordenadas del último punto de entrega del historial
      const entregaEvent = [...(this.historialTracking || [])]
        .filter(h => h.type === 'ENTREGA' && h.lat && h.lng)
        .sort((a, b) => b.timestamp - a.timestamp)[0];
      if (entregaEvent) {
        latDestino = entregaEvent.lat;
        lngDestino = entregaEvent.lng;
      } else {
        this.etaInfo = null;
        return;
      }
    }

    if (this.selectedPedidoParaRuta.estado === 'COMPLETADA') {
      this.etaInfo = null;
      return;
    }

    // El ETA solo tiene sentido cuando el chofer YA recibió la carga
    // (fecha_recepcion_chofer registrada) y el viaje está EN RUTA hacia el
    // destino. Mientras el viaje siga solo ASIGNADO (despachado pero aún no
    // recepcionado por el chofer), el ETA no debe mostrarse. En pedidos
    // multi-viaje, el ETA siempre corresponde al viaje activo en curso.
    const viajeEnCurso = this.viajeEnRuta();
    if (!viajeEnCurso) {
      this.etaInfo = null;
      return;
    }
    const viajeNum = viajeEnCurso.numero_viaje_secuencial || 1;

    // Usar SOLO el GPS del viaje en curso (no de todos los viajes del pedido),
    // para que el ETA no se calcule con puntos de un viaje ya entregado.
    const gpsDelViaje = (viajeEnCurso.gpsPuntos && viajeEnCurso.gpsPuntos.length)
      ? viajeEnCurso.gpsPuntos
      : (this.puntosRuta || []);

    // Buscar el punto de despacho / recepción más reciente
    let fallbackLat: number | null = null;
    let fallbackLng: number | null = null;
    let fallbackDate = new Date(this.selectedPedidoParaRuta.created_at || Date.now());
    
    if (this.historialTracking && this.historialTracking.length > 0) {
      const dispatchEvents = this.historialTracking.filter(h => h.type === 'DESPACHO' || h.type === 'RECEPCION');
      if (dispatchEvents.length > 0) {
        // historialTracking está ordenado DESCENDENTE → [0] es el más reciente
        const lastEvent = dispatchEvents[0];
        fallbackLat = lastEvent.lat;
        fallbackLng = lastEvent.lng;
        fallbackDate = lastEvent.timestamp;
      }
    }

    let latOrigen = fallbackLat;
    let lngOrigen = fallbackLng;
    let tsActual = fallbackDate;
    let tieneGps = false;
    let sortedAsc: any[] = [];

    if (gpsDelViaje.length > 0) {
      // Orden ascendente por timestamp: el último elemento es la posición actual
      sortedAsc = [...gpsDelViaje].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      const utl = sortedAsc[sortedAsc.length - 1];
      if (utl && Number(utl.latitud) && Number(utl.longitud)) {
        latOrigen = Number(utl.latitud);
        lngOrigen = Number(utl.longitud);
        tsActual = new Date(utl.timestamp);
        tieneGps = true;
      }
    }

    if (!latOrigen || !lngOrigen) {
      this.etaInfo = null;
      return;
    }

    const latD = latDestino!;
    const lngD = lngDestino!;

    const dist = this.haversineKm(latOrigen, lngOrigen, latD, lngD);
    const ahora = new Date();
    const edadMin = Math.round((ahora.getTime() - tsActual.getTime()) / 60000);

    let vel = 35;

    if (tieneGps && sortedAsc.length >= 2) {
      // Los dos últimos puntos (en orden cronológico) definen la velocidad
      const current = sortedAsc[sortedAsc.length - 1];
      const prev = sortedAsc[sortedAsc.length - 2];
      const d = this.haversineKm(prev.latitud, prev.longitud, current.latitud, current.longitud);
      const t = (new Date(current.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 3600000;
      if (t > 0) {
        vel = d / t;
        if (vel < 5) vel = 5;
        if (vel > 90) vel = 90;
      }
    }

    const estaDetenido = tieneGps && vel <= 5 && edadMin > 10;
    const etaHoras = dist / vel;
    const etaDate = new Date(Date.now() + etaHoras * 3_600_000);

    this.etaInfo = {
      eta: etaDate.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' }),
      distanciaKm: Math.round(dist * 10) / 10,
      velocidadKmh: Math.round(vel * 10) / 10,
      esEstimado: (!tieneGps || edadMin > 5),
      detenido: estaDetenido,
      edadMin: edadMin,
      viajeNum: viajeNum
    };
  }

  /**
   * Devuelve el viaje del pedido que está EN RUTA o ASIGNADO (el "viaje en curso").
   * Se usa para: marcador vivo y atribución de puntos GPS sin secuencial.
   */
  private viajeEnCurso(): any {
    return this.viajesAuditoria.find(
      v => v.despacho && (v.despacho.estado_viaje === 'EN RUTA' || v.despacho.estado_viaje === 'ASIGNADO')
    );
  }

  /**
   * Devuelve el viaje del pedido cuyo chofer YA confirmó la recepción de la carga
   * (fecha_recepcion_chofer) y está EN RUTA hacia el destino.
   * Es el único caso en el que tiene sentido mostrar un ETA de llegada.
   * (viajeEnCurso, en cambio, también incluye viajes ASIGNADOS aún no
   * recepcionados, que se usan para el marcador vivo y la atribución de GPS.)
   */
  private viajeEnRuta(): any {
    return this.viajesAuditoria.find(
      v => v.despacho
        && v.despacho.estado_viaje === 'EN RUTA'
        && !!v.despacho.fecha_recepcion_chofer
    );
  }
}
