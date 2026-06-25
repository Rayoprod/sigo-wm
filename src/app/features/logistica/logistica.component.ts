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
import { InputTextModule } from 'primeng/inputtext';
import { ImageModule } from 'primeng/image';

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
    ImageModule
  ],
  templateUrl: './logistica.component.html',
  styleUrl: './logistica.component.scss'
})
export class LogisticaComponent implements OnInit, OnDestroy {
  supabase = inject(SupabaseService).client;
  auth = inject(AuthService);

  pedidos: any[] = [];
  loading = true;
  vehiculosOptions: any[] = [];
  choferesOptions: any[] = [];

  // Detalles expandidos (Mobile y Desktop)
  expandedPedidoId: string | null = null;
  expandedRows: { [key: string]: boolean } = {};
  itemsDelPedidoMap: { [key: string]: any[] } = {};
  loadingItemsMap: { [key: string]: boolean } = {};
  
  viajesDelPedidoMap: { [key: string]: any[] } = {};
  loadingViajesMap: { [key: string]: boolean } = {};

  displayViajeModal = false;
  displayAsignarModal = false;
  selectedChoferId: string | null = null;
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
  selectedAuditoriaItem: any = null;

  realtimeChannel: any;
  rutaRealtimeChannel: any;
  currentUserRole: string | undefined;

  async ngOnInit() {
    const user = this.auth.currentUser();
    this.currentUserRole = user?.rol;
    await this.cargarPedidos();
    await this.cargarVehiculos();
    await this.cargarChoferes();
    this.suscribirCambiosViajes();
  }

  async cargarVehiculos() {
    const { data } = await this.supabase.from('vehiculos').select('placa').order('placa');
    if (data) {
      this.vehiculosOptions = data.map(v => ({ label: v.placa, value: v.placa }));
    }
  }

  async cargarChoferes() {
    const { data } = await this.supabase.from('usuarios').select('id, nombre_completo').eq('rol', 'chofer').order('nombre_completo');
    if (data) {
      this.choferesOptions = data.map(c => ({ label: c.nombre_completo, value: c.id }));
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
      .select('*, clientes(nombre_razon_social), chofer:usuarios!pedidos_chofer_id_fkey(nombre_completo)')
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

  async cargarViajesPedido(pedidoId: string) {
    if (this.viajesDelPedidoMap[pedidoId]) return;

    this.loadingViajesMap[pedidoId] = true;
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
    this.loadingViajesMap[pedidoId] = false;
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
    const enTransitoMap = await this.obtenerCantidadesEnTransito(pedido.id);
    
    this.viajeForm = {
      placa: '',
      lat: null,
      lng: null,
      fotosFiles: [],
      items: (this.itemsDelPedidoMap[pedido.id] || []).map((item: any) => {
        const enTransito = enTransitoMap[item.id] || 0;
        const restante = Number(item.cantidad) - Number(item.cantidad_despachada || 0) - enTransito;
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
    const itemsAEnviar = this.viajeForm.items.filter(i => i.cantidad_viaje > 0);
    if (itemsAEnviar.length === 0) {
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

      // 2. Insertar Cabecera (Registro desde base sin asignación obligatoria en este botón)
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

        // 4. ELIMINADO: Ya no se actualiza cantidad_despachada aquí. Lo hará la BD cuando el chofer entregue.
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

  // --- ASIGNACIÓN DE CHOFER ÚNICA ---
  async openAsignarModal(pedido: any) {
    this.selectedPedido = pedido;
    this.selectedChoferId = null;
    this.displayAsignarModal = true;
    
    // Cargar los items si no están en caché
    if (!this.itemsDelPedidoMap[pedido.id]) {
      await this.cargarItemsPedido(pedido.id);
    }
  }

  async asignarChofer() {
    if (!this.selectedChoferId) {
      alert("Debes seleccionar un chofer.");
      return;
    }

    this.isSavingViaje = true;
    try {
      const { error: updateError } = await this.supabase
        .from('pedidos')
        .update({
          chofer_id: this.selectedChoferId
        })
        .eq('id', this.selectedPedido.id);

      if (updateError) throw updateError;

      alert("Chofer asignado al pedido con éxito. Todos los viajes registrados para este pedido se le asignarán automáticamente.");
      this.displayAsignarModal = false;
      
      // Refrescar los pedidos para que se muestre la asignación
      await this.cargarPedidos();

    } catch (error: any) {
      alert("Error al asignar el chofer: " + error.message);
    } finally {
      this.isSavingViaje = false;
    }
  }

  // --- ASIGNAR CHOFER A VIAJE YA CREADO ---
  displayAsignarViajeExistenteModal = false;
  selectedViajeToAssign: any = null;

  openAsignarViajeExistenteModal(viaje: any) {
    this.selectedViajeToAssign = viaje;
    this.selectedChoferId = null;
    this.displayAsignarViajeExistenteModal = true;
  }

  async asignarChoferAViajeExistente() {
    if (!this.selectedChoferId) {
      alert("Debes seleccionar un chofer.");
      return;
    }

    this.isSavingViaje = true;
    try {
      const { error: updateError } = await this.supabase
        .from('despachos_viajes_cabecera')
        .update({
          chofer_id: this.selectedChoferId,
          estado_viaje: 'ASIGNADO'
        })
        .eq('id', this.selectedViajeToAssign.id);

      if (updateError) throw updateError;

      alert("Chofer asignado al viaje con éxito.");
      this.displayAsignarViajeExistenteModal = false;
      
      // Refrescar los viajes del pedido para que se vea el nombre del chofer
      delete this.viajesDelPedidoMap[this.selectedViajeToAssign.pedido_id]; // invalidar cache
      await this.cargarViajesPedido(this.selectedViajeToAssign.pedido_id);

    } catch (error: any) {
      alert("Error al asignar el chofer: " + error.message);
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
    this.selectedAuditoriaItem = null;

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
          this.refrescarDatosRuta();
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rutas_gps' }, payload => {
        const item = payload.new as any;
        if (this.selectedPedidoParaRuta && item && item.pedido_id === this.selectedPedidoParaRuta.id) {
          this.refrescarDatosRuta();
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'viajes_entregas' }, payload => {
        const item = (payload.new || payload.old) as any;
        if (this.selectedPedidoParaRuta && item && item.pedido_id === this.selectedPedidoParaRuta.id) {
          this.refrescarDatosRuta();
        }
      })
      .subscribe();

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

      // 2. Obtener puntos GPS continuos del chofer (ordenados)
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
        this.initMapUnified();
      }, 300);

    } catch (e) {
      console.error('Error al cargar/refrescar historial y rutas:', e);
      alert('Error cargando historial y rutas.');
    }
  }
  }

  // OSRM eliminado para graficar los puntos GPS reales (camino de puntos) sin "vueltones"
  async initMapUnified() {
    const container = document.getElementById('ruta-mapa-unificado');
    if (!container) return;

    if (!this.map) {
      this.map = L.map(container);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(this.map);
    } else {
      // Limpiar capas existentes (marcadores y polilíneas) excepto el mapa base
      this.map.eachLayer((layer: any) => {
        if (layer instanceof L.TileLayer) return;
        this.map!.removeLayer(layer);
      });
    }

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

    const viajesADibujar = this.selectedAuditoriaItem ? [this.selectedAuditoriaItem] : this.viajesAuditoria;

    for (const aud of viajesADibujar) {
      const pts = aud.mapaPuntos as L.LatLngTuple[];
      if (pts && pts.length > 0) {
        // Dibujar línea punteada directa ("camino de hormigas") usando los puntos crudos
        L.polyline(pts, {
          color: aud.mapaColor,
          weight: 4,
          opacity: 0.9,
          dashArray: '10, 14', // Línea punteada según especificación
        }).addTo(this.map);

        // Añadir marcadores
        pts.forEach((p, index) => {
          if (index === 0 && aud.despacho) {
            L.marker(p, { icon: iconStart }).addTo(this.map!);
          } else if (index === pts.length - 1 && aud.chofer) {
            L.marker(p, { icon: iconEnd }).addTo(this.map!);
          } else {
            // Puntos intermedios pasivos del chofer
            L.circleMarker(p, { radius: 3, color: aud.mapaColor, fillOpacity: 0.8 }).addTo(this.map!);
          }
          bounds.extend(p);
          pointsAdded++;
        });
      }
    }

    // Marcador de camión en vivo si hay un punto GPS reciente (< 2 minutos)
    if (this.puntosRuta.length > 0) {
      const sorted = [...this.puntosRuta].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      
      // Si estamos filtrando, usamos el último punto del viaje filtrado, si no, el último general
      let ultimoPunto = sorted[0];
      if (this.selectedAuditoriaItem && this.selectedAuditoriaItem.gpsPuntos && this.selectedAuditoriaItem.gpsPuntos.length > 0) {
          const sortedViaje = [...this.selectedAuditoriaItem.gpsPuntos].sort(
              (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );
          ultimoPunto = sortedViaje[0];
      }

      const esReciente = (Date.now() - new Date(ultimoPunto.timestamp).getTime()) < 120000;

      if (esReciente && !this.selectedAuditoriaItem) { // Solo mostrar "en vivo" si vemos todo
        const iconVivo = L.divIcon({
          className: '',
          html: `<div style="background-color: #3b82f6; color: white; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 15px rgba(59, 130, 246, 0.8);">
                   <i class="pi pi-truck" style="font-size: 1.4rem;"></i>
                 </div>`,
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        });
        L.marker([ultimoPunto.latitud, ultimoPunto.longitud], { icon: iconVivo })
          .addTo(this.map!)
          .bindPopup('🚛 Chofer activo ahora', { autoClose: false })
          .openPopup();
      } else if (this.selectedAuditoriaItem && this.selectedAuditoriaItem.chofer == null) {
        // Si filtramos un viaje y AUN NO ESTA ENTREGADO, pintamos el camión en la última posición conocida de ese viaje
        const iconCamion = L.divIcon({
          className: '',
          html: `<div style="background-color: #f59e0b; color: white; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px rgba(245, 158, 11, 0.6);">
                   <i class="pi pi-truck" style="font-size: 1.2rem;"></i>
                 </div>`,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        });
        L.marker([ultimoPunto.latitud, ultimoPunto.longitud], { icon: iconCamion })
          .addTo(this.map!)
          .bindPopup('🚛 Última posición en este viaje');
      }
    }

    if (pointsAdded > 0) {
      this.map.fitBounds(bounds, { padding: [40, 40] });
    } else {
      this.map.setView([-12.046374, -77.042793], 13); // Lima por defecto
    }
  }

  enfocarEnViaje(viajeItem: any) {
    if (this.selectedAuditoriaItem === viajeItem) {
        this.selectedAuditoriaItem = null; // Toggle off
    } else {
        this.selectedAuditoriaItem = viajeItem; // Toggle on
    }
    
    this.initMapUnified();
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
    if (this.rutaRealtimeChannel) {
      this.supabase.removeChannel(this.rutaRealtimeChannel);
      this.rutaRealtimeChannel = null;
    }
  }

  abrirMapa(lat: number, lng: number) {
    window.open(`http://maps.google.com/?q=${lat},${lng}`, '_blank');
  }

  abrirFoto(url: string) {
    window.open(url, '_blank');
  }
}
