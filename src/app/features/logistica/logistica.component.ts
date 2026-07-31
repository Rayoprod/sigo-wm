import { Component, OnInit, inject, OnDestroy, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService } from '../../core/services/supabase.service';
import { AuthService } from '../../core/services/auth.service';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { Pedidos, DespachosViajesCabecera, PedidosItems, ViajesEntregas, SesionesGps, RutasGps } from '../../core/models/app.models';

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
    QRCodeModule
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
  
  viajesDelPedidoMap: { [key: string]: DespachosViajesCabecera[] } = {};
  loadingViajesMap: { [key: string]: boolean } = {};
  expandedViajeMap: { [key: number]: boolean } = {};

  displayViajeModal = false;
  displayAsignarModal = false;
  selectedChoferId: string | null = null;
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
  displayAuditoriaModal = false;
  viajesAuditoria: any[] = []; // Unified map object
  loadingAuditoria = false;

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
  currentUserRole: string | undefined;

  sesionesHuerfanas: any[] = [];

  async ngOnInit() {
    const user = this.auth.currentUser();
    const roles = user?.rol || [];
    this.currentUserRole = Array.isArray(roles) ? roles[0] : roles;
    await this.cargarPedidos();
    await this.cargarVehiculos();
    this.suscribirCambiosViajes();
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
          this.cargarViajesPedido(targetId, true);
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
        
        // Si hay filas expandidas o modal de auditoría, refrescar sus items y viajes silenciosamente
        const targets = new Set<string>();
        if (this.expandedPedidoId) targets.add(this.expandedPedidoId);
        if (this.displayAuditoriaModal && this.selectedPedido) targets.add(this.selectedPedido.id);
        
        Object.keys(this.expandedRows).forEach(id => {
          if (this.expandedRows[id]) targets.add(id);
        });

        for (const targetId of targets) {
          await this.cargarItemsPedido(targetId, true);
          await this.cargarViajesPedido(targetId, true);
        }
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
      this.pedidos = data || [];
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
      await this.cargarViajesPedido(pedidoId);
    }
  }

  async onRowExpand(event: any) {
    const pedidoId = event.data.id;
    await this.cargarItemsPedido(pedidoId);
    await this.cargarViajesPedido(pedidoId);
  }

  async onRowCollapse(event: any) {
    // Opcional: limpiar cache si quisieras, pero usualmente se deja guardado
  }

  async cargarItemsPedido(pedidoId: string, silent: boolean = false) {
    if (this.itemsDelPedidoMap[pedidoId] && !silent) return; // Evitar recarga si ya está en caché

    if (!silent) this.loadingItemsMap[pedidoId] = true;
    const { data, error } = await this.supabase
      .from('pedidos_items')
      .select('*, productos(descripcion, unidad_medida)')
      .eq('pedido_id', pedidoId);

    if (!error) {
      this.itemsDelPedidoMap[pedidoId] = data || [];
    }
    if (!silent) this.loadingItemsMap[pedidoId] = false;
  }

  async cargarViajesPedido(pedidoId: string, silent: boolean = false) {
    if (this.viajesDelPedidoMap[pedidoId] && !silent) return;

    if (!silent) this.loadingViajesMap[pedidoId] = true;
    const { data, error } = await this.supabase
      .from('despachos_viajes_cabecera')
      .select(`
        *,
        usuarios!despachos_viajes_cabecera_chofer_id_fkey(nombre_completo)
      `)
      .eq('pedido_id', pedidoId)
      .order('numero_viaje_secuencial', { ascending: false });

    if (!error) {
      this.viajesDelPedidoMap[pedidoId] = data || [];
    }
    if (!silent) this.loadingViajesMap[pedidoId] = false;
  }

  async obtenerCantidadesEnTransito(pedidoId: string): Promise<Record<string, number>> {
    const { data, error } = await this.supabase
      .from('despachos_viajes_detalle')
      .select('pedido_item_id, cantidad_viaje, despachos_viajes_cabecera!inner(estado_viaje, pedido_id)')
      .eq('despachos_viajes_cabecera.pedido_id', pedidoId)
      .in('despachos_viajes_cabecera.estado_viaje', ['ASIGNADO', 'EN RUTA']);

    const enTransitoMap: Record<string, number> = {};
    if (!error && data) {
      data.forEach((d: any) => {
        enTransitoMap[d.pedido_item_id] = (enTransitoMap[d.pedido_item_id] || 0) + Number(d.cantidad_viaje);
      });
    }
    return enTransitoMap;
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
        // no debemos volver a restar lo que está 'en tránsito'
        const restante = Number(item.cantidad) - Number(item.cantidad_despachada || 0);
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

  // Comprimir imagen localmente antes de subir
  comprimirImagen(file: File): Promise<File> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = event => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
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
        img.onerror = error => reject(error);
      };
      reader.onerror = error => reject(error);
    });
  }

  // --- GENERADOR DE QR COMPRIMIDO ---
  generarPayloadQR(cabecera: any, detalles: any[]): string {
    const minMap = {
      t: 'h',
      i: cabecera.id,
      pi: cabecera.pedido_id,
      pf: this.selectedPedido?.folio || this.selectedPedidoParaRuta?.folio || '',
      pv: cabecera.placa_vehiculo || '',
      fd: new Date().toISOString(),
      ns: cabecera.numero_viaje_secuencial || 0,
      ci: cabecera.chofer_id || '',
      di: cabecera.despachador_id || '',
      dt: detalles.map((d: any) => ({
        id: d.id,
        pi: d.pedido_item_id,
        cv: d.cantidad_viaje,
        desc: d.pedidos_items?.productos?.descripcion || d.pedidos_items?.descripcion_manual || d.descripcion || '',
        um: d.pedidos_items?.productos?.unidad_medida || d.pedidos_items?.unidad_medida_manual || d.unidad_medida || ''
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

      // 1.6 Guardar placa en base de datos global (si es nueva)
      if (this.viajeForm.placa && this.viajeForm.placa.trim().length > 0) {
        const p = this.viajeForm.placa.trim().toUpperCase();
        try {
          await this.supabase.from('vehiculos').insert({ placa: p });
          if (!this.vehiculosOptions.find(o => o.value === p)) {
            this.vehiculosOptions.push({ label: p, value: p });
          }
        } catch (e) {
          // Ignorar error si ya existe
        }
      }

      // 2. Insertar Cabecera
      const { data: cabeceraData, error: insertError } = await this.supabase
        .from('despachos_viajes_cabecera')
        .insert({
          pedido_id: this.selectedPedido!.id,
          despachador_id: user?.id,
          placa_vehiculo: this.viajeForm.placa?.trim().toUpperCase(),
          numero_viaje_secuencial: numSecuencial,
          estado_viaje: 'ASIGNADO',
          latitud: this.viajeForm.lat,
          longitud: this.viajeForm.lng,
          fotos_urls: fotosUrls
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // 3. Insertar Detalles
      const detallesAInsertar = this.viajeForm.items
        .filter(i => i.cantidad_viaje > 0)
        .map(i => ({
          viaje_id: cabeceraData.id,
          pedido_item_id: i.id,
          cantidad_viaje: i.cantidad_viaje
        }));

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
      
      // Refrescar el ítem y los viajes del pedido
      delete this.viajesDelPedidoMap[this.selectedPedido!.id];
      await this.cargarViajesPedido(this.selectedPedido!.id);
      await this.cargarItemsPedido(this.selectedPedido!.id);
      await this.cargarPedidos();

    } catch (error: any) {
      alert("Error al registrar el viaje: " + error.message);
    } finally {
      this.isSavingViaje = false;
    }
  }

  // --- ASIGNACIÓN DE CHOFER ÚNICA ---
  async tieneRutaEnCurso(pedidoId: string): Promise<boolean> {
    try {
      const { data: sesiones } = await this.supabase
        .from('sesiones_gps')
        .select('id')
        .eq('pedido_id', pedidoId)
        .eq('estado', 'ACTIVO')
        .limit(1);

      if (sesiones && sesiones.length > 0) return true;

      const { data: viajes } = await this.supabase
        .from('despachos_viajes_cabecera')
        .select('id')
        .eq('pedido_id', pedidoId)
        .eq('estado_viaje', 'EN RUTA')
        .limit(1);

      return !!(viajes && viajes.length > 0);
    } catch (e) {
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

    try {
      // 1. Obtener datos del Despacho (Salidas desde la Planta)
      const { data: despachosData } = await this.supabase
        .from('despachos_viajes_cabecera')
        .select(`
          *,
          usuarios:usuarios!despachos_viajes_cabecera_despachador_id_fkey (correo, nombre_completo),
          chofer_cabecera:usuarios!despachos_viajes_cabecera_chofer_id_fkey (nombre_completo),
          despachos_viajes_detalle (
            cantidad_viaje,
            pedidos_items (
              productos(descripcion),
              descripcion_manual,
              unidad_medida_manual
            )
          )
        `)
        .eq('pedido_id', this.selectedPedidoParaRuta.id)
        .order('numero_viaje_secuencial', { ascending: true });

      // 2. Obtener puntos GPS del chofer (consultar TODOS los del pedido, porque offline pueden no tener sesion_id)
      const { data: gpsData } = await this.supabase
          .from('rutas_gps')
          .select('*')
          .eq('pedido_id', this.selectedPedidoParaRuta.id)
          .order('timestamp', { ascending: true });
        
      if (gpsData) {
        this.puntosRuta = gpsData.filter(p => p.latitud && p.longitud && p.latitud !== 0 && p.longitud !== 0);
      }

      // 3. Obtener entregas del chofer (Llegadas al cliente)
      const { data: entregasData } = await this.supabase
        .from('viajes_entregas')
        .select('*, chofer:usuarios(nombre_completo)')
        .eq('pedido_id', this.selectedPedidoParaRuta.id)
        .order('created_at', { ascending: true });

      if (entregasData) {
        this.entregasRuta = entregasData.filter(e => e.latitud && e.longitud && e.latitud !== 0 && e.longitud !== 0);
      }

      // 4. Consolidar para Auditoría visual (Tarjetas)
      const consolidadosMap = new Map<number, any>();
      
      // Registrar despachos
      (despachosData || []).forEach(d => {
        const num = d.numero_viaje_secuencial || 1;
        consolidadosMap.set(num, { numero_viaje_secuencial: num, despacho: d, chofer: null });
      });
      
      // Registrar entregas
      (entregasData || []).forEach(c => {
        const num = c.numero_viaje_secuencial || 1;
        if (consolidadosMap.has(num)) {
          consolidadosMap.get(num).chofer = c;
        } else {
          consolidadosMap.set(num, { numero_viaje_secuencial: num, despacho: null, chofer: c });
        }
      });

      // Incorporar viajes que solo tengan puntos GPS pero ningún despacho ni entrega aún en la nube (flujo en progreso)
      (this.puntosRuta || []).forEach(p => {
        const num = p.numero_viaje_secuencial || 1;
        if (!consolidadosMap.has(num)) {
          consolidadosMap.set(num, { numero_viaje_secuencial: num, despacho: null, chofer: null });
        }
      });

      // Guardamos la lista de viajes en orden DECRECIENTE (el más reciente arriba)
      this.viajesAuditoria = Array.from(consolidadosMap.values())
        .sort((a, b) => b.numero_viaje_secuencial - a.numero_viaje_secuencial);

      this.viajesAuditoria.forEach((v, idx) => {
        if (this.expandedViajeMap[v.numero_viaje_secuencial] === undefined) {
          this.expandedViajeMap[v.numero_viaje_secuencial] = (idx === 0);
        }
      });

      // 5. Construir Historial Unificado para la línea de tiempo y colores
      this.historialTracking = [];
      const TRAMO_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#06b6d4', '#ec4899'];
      let currentTramoIndex = 0;

      // Agrupamos por Secuencial de Viaje para poder trazar un polyline por cada viaje
      for (const aud of this.viajesAuditoria) {
        const seqNum = aud.numero_viaje_secuencial;
        const colorTramo = TRAMO_COLORS[currentTramoIndex % TRAMO_COLORS.length];
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

        // 5b. Puntos GPS intermedios filtrados por secuencial de viaje
        const gpsDeEsteViaje = this.puntosRuta.filter(p => p.numero_viaje_secuencial === seqNum);
        aud.gpsPuntos = gpsDeEsteViaje; // Para el listado detallado de coordenadas

        gpsDeEsteViaje.forEach(p => {
          puntosDelViaje.push([p.latitud, p.longitud]);
        });

        // 5c. Añadir evento de Entrega
        if (aud.chofer && aud.chofer.latitud && aud.chofer.longitud) {
          puntosDelViaje.push([aud.chofer.latitud, aud.chofer.longitud]);
          this.historialTracking.push({
            type: 'ENTREGA',
            lat: aud.chofer.latitud,
            lng: aud.chofer.longitud,
            timestamp: new Date(aud.chofer.created_at),
            title: `Viaje #${seqNum} Entregado por ${aud.chofer.chofer?.nombre_completo || 'Chofer'}`,
            icon: 'pi pi-check-circle',
            color: 'text-green-500',
            bg: 'bg-green-100',
            tramoColor: colorTramo
          });
        }

        // Guardamos las coordenadas limpias para dibujar el Leaflet Polyline luego
        aud.mapaPuntos = puntosDelViaje;
        aud.mapaColor = colorTramo;

        currentTramoIndex++;
      }

      // Ordenar la línea de tiempo de manera DECRECIENTE (más recientes primero)
      this.historialTracking.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      // Renderizar el mapa de Leaflet
      setTimeout(() => {
        this.initBaseMap();              // Inicializa tile layer + grupos si es la primera vez
        const esPrimeraCarga = !this.mapInitialBoundsDone;
        this.renderMap(esPrimeraCarga); // fitBounds solo en la primera carga
      }, 300);

    } catch (e) {
      console.error('Error al cargar/refrescar historial y rutas:', e);
      alert('Error cargando historial y rutas.');
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

    this.map = L.map(container, { zoomControl: true });

    L.tileLayer(
      isDark
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      { attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 20 }
    ).addTo(this.map);

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
    } else if (this.mapFocus?.type === 'ruta') {
      const aud = this.mapFocus.viajeItem;
      const numViaje = aud.numero_viaje_secuencial;
      const color = TRAMO_COLORS[(numViaje - 1) % TRAMO_COLORS.length];

      const gps: L.LatLngTuple[] = (aud.gpsPuntos || []).map((p: any) => [p.latitud, p.longitud] as L.LatLngTuple);

      if (gps.length >= 2) {
        L.polyline(gps, { color, weight: 4, opacity: 0.95 }).addTo(this.layerGroupTramos!);
        gps.forEach(p => { bounds.extend(p); pointsAdded++; });
      }

      // Inicio verde
      if (gps.length > 0) {
        circulo(gps[0], numViaje, '#16a34a', 30)
          .bindPopup(`<b>🟢 Inicio Viaje #${numViaje}</b>`)
          .addTo(this.layerGroupMarcadores!);
        bounds.extend(gps[0]);
        pointsAdded++;
      }

      // Fin rojo (si tiene entrega)
      if (aud.chofer?.latitud && aud.chofer?.longitud) {
        const fin: L.LatLngTuple = [aud.chofer.latitud, aud.chofer.longitud];
        circulo(fin, numViaje, '#dc2626', 30)
          .bindPopup(`<b>🔴 Fin Viaje #${numViaje}</b><br>${aud.chofer.chofer?.nombre_completo || 'Chofer'}`)
          .addTo(this.layerGroupMarcadores!);
        bounds.extend(fin);
        pointsAdded++;
      }

    // ── CASO 3: Vista general (todos los viajes) ────────────────────────────
    } else {
      const viajes = [...this.viajesAuditoria].sort((a, b) => a.numero_viaje_secuencial - b.numero_viaje_secuencial);

      for (let idx = 0; idx < viajes.length; idx++) {
        const aud = viajes[idx];
        const color = TRAMO_COLORS[idx % TRAMO_COLORS.length];
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
    }

    // ── Marcador vivo (independiente del foco, siempre visible) ───────────────
    if (this.puntosRuta.length > 0) {
      const sorted = [...this.puntosRuta].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      const ultimo = sorted[0];
      const edadMs = Date.now() - new Date(ultimo.timestamp).getTime();

      if (edadMs < 180000) {
        const lv: L.LatLngTuple = [ultimo.latitud, ultimo.longitud];
        const iconVivo = L.divIcon({
          className: 'gps-live-icon-host',
          html: `<div class="gps-live-dot"><span class="gps-live-pulse"></span></div>`,
          iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -16]
        });
        if (this.liveMarker) {
          this.liveMarker.setLatLng(lv);
          if (!this.map!.hasLayer(this.liveMarker)) {
            this.liveMarker.addTo(this.layerGroupVivo!);
          }
        } else {
          this.liveMarker = L.marker(lv, { icon: iconVivo, zIndexOffset: 1000 })
            .bindPopup('🔵 Chofer en ruta ahora mismo')
            .addTo(this.layerGroupVivo!);
        }
      } else if (this.liveMarker) {
        this.layerGroupVivo?.removeLayer(this.liveMarker);
        this.liveMarker = null;
      }
    }

    // ── fitBounds: solo cuando se solicita explícitamente ────────────────────
    if (applyFitBounds) {
      if (pointsAdded > 0 && bounds.isValid()) {
        this.map!.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
      } else if (!this.mapInitialBoundsDone) {
        this.map!.setView([-12.046374, -77.042793], 13);
      }
      this.mapInitialBoundsDone = true;
    }
  }

  // ─── Acciones de foco ─────────────────────────────────────────────────────

  /** Botón "Ver ruta completa" de un viaje */
  enfocarEnViaje(viajeItem: any) {
    const esMismo = this.mapFocus?.type === 'ruta' && this.mapFocus.viajeItem === viajeItem;
    this.mapFocus = esMismo ? null : { type: 'ruta', viajeItem };
    this.renderMap(true); // fitBounds porque el usuario eligió un foco nuevo
  }

  /** Botón "Ver ubicación exacta" del despachador */
  enfocarEnPunto(lat: number, lng: number, label: string) {
    const esMismo = this.mapFocus?.type === 'punto'
      && this.mapFocus.lat === lat
      && this.mapFocus.lng === lng;
    this.mapFocus = esMismo ? null : { type: 'punto', lat, lng, label };
    this.renderMap(true); // fitBounds porque el usuario eligió un foco nuevo
  }


  initMap() {
    // Si no hay puntos, no se inicializa el mapa (se muestra el mensaje de vacío en HTML)
    if (this.puntosRuta.length === 0) return;

    // Solo inicializar si el div id="map" existe y el mapa no está inicializado
    const mapElement = document.getElementById('map');
    if (!mapElement) return;
    
    if (this.map) {
      setTimeout(() => this.map?.invalidateSize(), 300);
      return;
    }

    // Arreglar íconos de Leaflet por defecto en Angular
    const iconRetinaUrl = 'assets/marker-icon-2x.png';
    const iconUrl = 'assets/marker-icon.png';
    const shadowUrl = 'assets/marker-shadow.png';
    const iconDefault = L.icon({
      iconRetinaUrl,
      iconUrl,
      shadowUrl,
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      tooltipAnchor: [16, -28],
      shadowSize: [41, 41]
    });
    L.Marker.prototype.options.icon = iconDefault;

    // Primer punto como centro inicial
    const primerPunto = this.puntosRuta[0];
    this.map = L.map('map').setView([primerPunto.latitud, primerPunto.longitud], 14);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(this.map);

    // Extraer coordenadas
    const latlngs: L.LatLngExpression[] = this.puntosRuta.map(p => [p.latitud, p.longitud]);

    // Dibujar Tramos Segmentados (PRO)
    let currentSegmentLatLngs: L.LatLngExpression[] = [];
    let currentTramoColor = this.historialTracking.length > 0 ? this.historialTracking[0].tramoColor : '#01696f';

    this.historialTracking.forEach(item => {
      if (item.lat && item.lng) {
        if (item.type === 'GPS') {
          currentSegmentLatLngs.push([item.lat, item.lng]);
        }
        
        if (item.type === 'ENTREGA') {
          // Terminar el tramo actual conectándolo hasta la entrega
          currentSegmentLatLngs.push([item.lat, item.lng]);
          
          if (currentSegmentLatLngs.length > 1) {
            L.polyline(currentSegmentLatLngs, {
              color: currentTramoColor, 
              weight: 5,
              opacity: 0.9,
              lineJoin: 'round'
            }).addTo(this.map!);
          }

          // Iniciar el siguiente tramo desde aquí
          currentSegmentLatLngs = [[item.lat, item.lng]];
        }
        
        // Actualizar el color (para que coincida con el HTML)
        currentTramoColor = item.tramoColor;
      }
    });

    // Dibujar el último tramo restante
    if (currentSegmentLatLngs.length > 1) {
      L.polyline(currentSegmentLatLngs, {
        color: currentTramoColor, 
        weight: 5,
        opacity: 0.9,
        lineJoin: 'round',
        dashArray: '10, 10' // Tramo en curso como punteado opcional, o continuo
      }).addTo(this.map!);
    }

    // Ajustar el zoom para ver toda la ruta (si hay puntos GPS originales)
    if (this.map && latlngs.length > 1) {
      this.map.fitBounds(L.polyline(latlngs).getBounds(), { padding: [50, 50] });
    }

    // Dibujar todos los puntos del historial (Eventos, GPS, Entregas)
    this.historialTracking.forEach(item => {
      if (item.lat && item.lng) {
        let color = item.type === 'EVENTO' ? 'orange' : (item.type === 'ENTREGA' ? 'green' : '#3b82f6');
        let fillColor = 'white';
        let radius = item.type === 'GPS' ? 5 : 8; // GPS points are smaller

        L.circleMarker([item.lat, item.lng], {
          color: color,
          fillColor: fillColor,
          fillOpacity: 1,
          radius: radius,
          weight: item.type === 'GPS' ? 2 : 3
        }).addTo(this.map!).bindPopup(`<b>${item.title}</b><br>${item.timestamp.toLocaleString()}`);
      }
    });

    // Forzar redibujado porque el mapa está dentro de un Modal
    setTimeout(() => {
      this.map?.invalidateSize();
    }, 200);
  }

  centrarMapa(lat: number, lng: number, title: string, timestamp: Date) {
    if (this.map && lat && lng) {
      this.map.flyTo([lat, lng], 17, {
        animate: true,
        duration: 1.5
      });

      L.popup({ autoClose: true, closeOnClick: true })
        .setLatLng([lat, lng])
        .setContent(`<b>${title}</b><br>${timestamp.toLocaleString()}`)
        .openOn(this.map);
    }
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
    window.open(`http://maps.google.com/?q=${lat},${lng}`, '_blank');
  }

  abrirFoto(url: string) {
    window.open(url, '_blank');
  }

  // ─── Helpers para el template (evita errores de tipo con union discriminada) ─
  isFocusRuta(viajeItem: any): boolean {
    return this.mapFocus?.type === 'ruta' && (this.mapFocus as any).viajeItem === viajeItem;
  }

  isFocusPunto(lat: number, lng: number): boolean {
    return this.mapFocus?.type === 'punto'
      && (this.mapFocus as any).lat === lat
      && (this.mapFocus as any).lng === lng;
  }
}
