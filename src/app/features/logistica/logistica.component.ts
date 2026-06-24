import { Component, OnInit, inject, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService } from '../../core/services/supabase.service';
import { AuthService } from '../../core/services/auth.service';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';

import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { InputNumberModule } from 'primeng/inputnumber';
import { ProgressBarModule } from 'primeng/progressbar';
import { DialogModule } from 'primeng/dialog';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { DropdownModule } from 'primeng/dropdown';

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
    DropdownModule
  ],
  templateUrl: './logistica.component.html',
  styleUrl: './logistica.component.scss'
})
export class LogisticaComponent implements OnInit, OnDestroy {
  supabase = inject(SupabaseService).client;
  auth = inject(AuthService);

  pedidos: any[] = [];
  loading = false;
  vehiculosOptions: any[] = [];

  // Detalles expandidos (Mobile y Desktop)
  expandedPedidoId: string | null = null; // Mantenemos para compatibilidad con tarjetas móviles si es necesario, o usamos el Map
  expandedRows: { [key: string]: boolean } = {};
  itemsDelPedidoMap: { [pedidoId: string]: any[] } = {};
  loadingItemsMap: { [pedidoId: string]: boolean } = {};

  displayViajeModal = false;
  selectedPedido: any = null;
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
  viajesAuditoria: any[] = [];
  loadingAuditoria = false;

  // Mapa y Rastreo
  displayRutaModal = false;
  selectedPedidoParaRuta: any = null;
  loadingRuta = false;
  puntosRuta: any[] = [];
  entregasRuta: any[] = [];
  historialTracking: any[] = []; // Línea de tiempo unificada
  map: L.Map | null = null;
  polyline: L.Polyline | null = null;

  realtimeChannel: any;
  currentUserRole: string | undefined;

  async ngOnInit() {
    const user = this.auth.currentUser();
    this.currentUserRole = user?.rol;
    await this.cargarPedidos();
    await this.cargarVehiculos();
    this.suscribirCambiosViajes();
  }

  async cargarVehiculos() {
    const { data } = await this.supabase.from('vehiculos').select('placa').order('placa');
    if (data) {
      this.vehiculosOptions = data.map(v => ({ label: v.placa, value: v.placa }));
    }
  }

  ngOnDestroy() {
    if (this.realtimeChannel) {
      this.supabase.removeChannel(this.realtimeChannel);
    }
  }

  suscribirCambiosViajes() {
    this.realtimeChannel = this.supabase.channel('custom-viajes-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'despachos_viajes_detalle' }, payload => {
        if (this.expandedPedidoId) {
          this.cargarItemsPedido(this.expandedPedidoId);
        }
      })
      .subscribe();
  }

  async cargarPedidos() {
    this.loading = true;
    const { data, error } = await this.supabase
      .from('pedidos')
      .select('*, clientes(nombre_razon_social)')
      .eq('tipo_documento', 'ORDEN_VENTA')
      .in('estado', ['APROBADA', 'COMPLETADA'])
      .order('created_at', { ascending: false });

    if (!error) {
      this.pedidos = data || [];
    }
    this.loading = false;
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

  async cargarItemsPedido(pedidoId: string) {
    if (this.itemsDelPedidoMap[pedidoId]) return; // Evitar recarga si ya está en caché

    this.loadingItemsMap[pedidoId] = true;
    const { data, error } = await this.supabase
      .from('pedidos_items')
      .select('*, productos(descripcion, unidad_medida)')
      .eq('pedido_id', pedidoId);

    if (!error) {
      this.itemsDelPedidoMap[pedidoId] = data || [];
    }
    this.loadingItemsMap[pedidoId] = false;
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

  async guardarViaje() {
    const tieneItems = this.viajeForm.items.some(i => i.cantidad_viaje > 0);
    if (!tieneItems) {
      alert("Debes indicar la cantidad a despachar de al menos un material.");
      return;
    }
    
    this.isSavingViaje = true;
    
    try {
      const user = this.auth.currentUser();
      let fotosUrls: string[] = [];

      // 1. Comprimir y Subir fotos
      for (const file of this.viajeForm.fotosFiles) {
        const compressedFile = await this.comprimirImagen(file);
        const fileName = `viaje-${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
        const filePath = `evidencias_viajes/${fileName}`;

        const { error: uploadError } = await this.supabase.storage
          .from('assets')
          .upload(filePath, compressedFile);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = this.supabase.storage
          .from('assets')
          .getPublicUrl(filePath);
          
        fotosUrls.push(publicUrl);
      }

      // 1.5 Obtener/calcular numero_viaje_secuencial (clonando lógica Flutter)
      const { data: maxViajeData, error: maxViajeError } = await this.supabase
        .from('despachos_viajes_cabecera')
        .select('numero_viaje_secuencial')
        .eq('pedido_id', this.selectedPedido.id)
        .order('numero_viaje_secuencial', { ascending: false })
        .limit(1);
        
      let numSecuencial = 1;
      if (maxViajeData && maxViajeData.length > 0 && maxViajeData[0].numero_viaje_secuencial) {
        numSecuencial = Number(maxViajeData[0].numero_viaje_secuencial) + 1;
      }

      // 1.6 Guardar placa en base de datos global (si es nueva)
      if (this.viajeForm.placa && this.viajeForm.placa.trim().length > 0) {
        const p = this.viajeForm.placa.trim().toUpperCase();
        try {
          await this.supabase.from('vehiculos').insert({ placa: p });
          // Lo añadimos al dropdown si no falló
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
          pedido_id: this.selectedPedido.id,
          despachador_id: user?.id,
          placa_vehiculo: this.viajeForm.placa?.trim().toUpperCase(),
          numero_viaje_secuencial: numSecuencial,
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

        // 4. Actualizar la cantidad despachada en pedidos_items
        for (const item of this.viajeForm.items) {
          if (item.cantidad_viaje > 0) {
            const originalItem = (this.itemsDelPedidoMap[this.selectedPedido.id] || []).find((i: any) => i.id === item.id);
            const nuevaCantidad = Number(originalItem?.cantidad_despachada || 0) + Number(item.cantidad_viaje);
            
            const { error: updateError } = await this.supabase
              .from('pedidos_items')
              .update({ cantidad_despachada: nuevaCantidad })
              .eq('id', item.id);
              
            if (updateError) {
              console.error('Error al actualizar la cantidad_despachada:', updateError);
            }
          }
        }
      }

      alert("Viaje registrado con éxito. Fotos comprimidas y guardadas.");
      this.displayViajeModal = false;
      // Refrescar el ítem actual
      await this.cargarItemsPedido(this.selectedPedido.id);

    } catch (error: any) {
      alert("Error al registrar el viaje: " + error.message);
    } finally {
      this.isSavingViaje = false;
    }
  }

  // ====== HISTORIAL, RASTREO Y MAPAS ======

  async abrirRutaChofer(pedido: any) {
    this.selectedPedidoParaRuta = pedido;
    this.displayRutaModal = true;
    this.loadingRuta = true;
    this.puntosRuta = [];
    this.entregasRuta = [];
    this.viajesAuditoria = [];

    // Limpiar el mapa actual si existe
    if (this.map) {
      this.map.remove();
      this.map = null;
    }

    try {
      // 1. Obtener datos del Despacho (Salidas desde la Planta)
      const { data: despachosData, error: errorDespachos } = await this.supabase
        .from('despachos_viajes_cabecera')
        .select(`
          *,
          usuarios (correo, nombre_completo),
          despachos_viajes_detalle (
            cantidad_viaje,
            pedidos_items (
              productos(descripcion),
              descripcion_manual,
              unidad_medida_manual
            )
          )
        `)
        .eq('pedido_id', pedido.id)
        .order('numero_viaje_secuencial', { ascending: true });

      // 2. Obtener puntos GPS continuos del chofer (ordenados)
      const { data: gpsData } = await this.supabase
        .from('rutas_gps')
        .select('*')
        .eq('pedido_id', pedido.id)
        .order('timestamp', { ascending: true });
        
      if (gpsData) {
        this.puntosRuta = gpsData.filter(p => p.latitud && p.longitud && p.latitud !== 0 && p.longitud !== 0);
      }

      // 3. Obtener entregas del chofer (Llegadas al cliente)
      const { data: entregasData } = await this.supabase
        .from('viajes_entregas')
        .select('*, chofer:usuarios(nombre_completo)')
        .eq('pedido_id', pedido.id)
        .order('created_at', { ascending: true });

      if (entregasData) {
        this.entregasRuta = entregasData.filter(e => e.latitud && e.longitud && e.latitud !== 0 && e.longitud !== 0);
      }

      // 4. Consolidar para Auditoría visual (Tarjetas)
      const consolidadosMap = new Map<number, any>();
      (despachosData || []).forEach(d => {
        const num = d.numero_viaje_secuencial || 1;
        consolidadosMap.set(num, { numero_viaje_secuencial: num, despacho: d, chofer: null });
      });
      (entregasData || []).forEach(c => {
        const num = c.numero_viaje_secuencial || 1;
        if (consolidadosMap.has(num)) {
          consolidadosMap.get(num).chofer = c;
        } else {
          consolidadosMap.set(num, { numero_viaje_secuencial: num, despacho: null, chofer: c });
        }
      });
      this.viajesAuditoria = Array.from(consolidadosMap.values())
        .sort((a, b) => a.numero_viaje_secuencial - b.numero_viaje_secuencial);

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
            color: 'text-orange-500',
            bg: 'bg-orange-100',
            tramoColor: colorTramo
          });
        }

        // 5b. Puntos GPS intermedios, intentaremos inferir si pertenecen a este viaje
        // Asumimos que los GPS points pertenecen a un viaje si caen temporalmente entre el despacho y la entrega.
        // Si no hay entrega, hasta "ahora". Si no hay despacho, desde "el principio de los tiempos".
        const startTime = aud.despacho ? new Date(aud.despacho.created_at).getTime() : 0;
        const endTime = aud.chofer ? new Date(aud.chofer.created_at).getTime() : Date.now() + 9999999;
        
        const gpsDeEsteViaje = this.puntosRuta.filter(p => {
          const t = new Date(p.timestamp).getTime();
          return t >= startTime && t <= endTime;
        });

        gpsDeEsteViaje.forEach(p => {
          puntosDelViaje.push([p.latitud, p.longitud]);
          // No mostramos en timeline los puntos intermedios para no saturar, solo en el mapa.
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

      this.historialTracking.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      // Renderizar el mapa de Leaflet
      setTimeout(() => {
        this.initMapUnified();
      }, 300);

    } catch (e) {
      console.error(e);
      alert('Error cargando historial y rutas.');
    } finally {
      this.loadingRuta = false;
    }
  }

  initMapUnified() {
    if (this.map) {
      this.map.remove();
    }

    const container = document.getElementById('ruta-mapa-unificado');
    if (!container) return;

    this.map = L.map(container);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    const bounds = L.latLngBounds([]);
    let pointsAdded = 0;

    // Iconos
    const iconStart = L.icon({
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
      iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
    });
    const iconEnd = L.icon({
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
      iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
    });
    const iconPoint = L.icon({
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
      iconSize: [12, 20], iconAnchor: [6, 20]
    });

    for (const aud of this.viajesAuditoria) {
      const pts = aud.mapaPuntos as L.LatLngTuple[];
      if (pts && pts.length > 0) {
        // Dibujar polyline
        L.polyline(pts, { color: aud.mapaColor, weight: 5, opacity: 0.8 }).addTo(this.map);

        // Añadir marcadores
        pts.forEach((p, index) => {
          let markIcon = iconPoint;
          if (index === 0 && aud.despacho) markIcon = iconStart; // Primer punto es salida si hay despacho
          else if (index === pts.length - 1 && aud.chofer) markIcon = iconEnd; // Último es llegada si hay entrega

          const marker = L.marker(p, { icon: markIcon }).addTo(this.map!);
          bounds.extend(p);
          pointsAdded++;
        });
      }
    }

    if (pointsAdded > 0) {
      this.map.fitBounds(bounds, { padding: [30, 30] });
    } else {
      this.map.setView([-12.046374, -77.042793], 13); // Lima por defecto
    }
  }

  enfocarEnViaje(viajeItem: any) {
    if (!this.map || !viajeItem.mapaPuntos || viajeItem.mapaPuntos.length === 0) return;
    
    const bounds = L.latLngBounds(viajeItem.mapaPuntos);
    this.map.flyToBounds(bounds, { padding: [50, 50], maxZoom: 16, duration: 1 });
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

  cerrarRutaModal() {
    this.displayRutaModal = false;
    this.selectedPedidoParaRuta = null;
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  abrirMapa(lat: number, lng: number) {
    window.open(`http://maps.google.com/?q=${lat},${lng}`, '_blank');
  }

  abrirFoto(url: string) {
    window.open(url, '_blank');
  }
}
