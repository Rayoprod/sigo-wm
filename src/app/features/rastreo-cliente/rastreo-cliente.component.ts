import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import * as L from 'leaflet';
import { PeruDatePipe } from '../../shared/pipes/peru-date.pipe';
import { buildLiveTruckIcon, LiveTruckState } from '../../shared/utils/live-truck-marker';

@Component({
  selector: 'app-rastreo-cliente',
  standalone: true,
  imports: [CommonModule, HttpClientModule, PeruDatePipe],
  templateUrl: './rastreo-cliente.component.html',
  styleUrls: ['./rastreo-cliente.component.scss']
})
export class RastreoClienteComponent implements OnInit, OnDestroy {
  token: string = '';
  loading: boolean = true;
  error: string = '';
  trackingData: any = null;

  refreshInterval: any;

  // Mapa
  private map: L.Map | null = null;
  private markerCamion: L.Marker | null = null;
  private markerDestino: L.Marker | null = null;
  /** Evita resetear el zoom cuando el usuario ha hecho zoom manual. */
  private fitBoundsDone = false;

  etaInfo: {
    eta: string;
    etaDia: string;
    distanciaKm: string;
    esEstimado: boolean;
    edadMin: number;
  } | null = null;

  constructor(private route: ActivatedRoute, private http: HttpClient) {}

  ngOnInit() {
    this.token = this.route.snapshot.paramMap.get('token') || '';
    if (!this.token) {
      this.error = 'Enlace de rastreo no válido o expirado.';
      this.loading = false;
      return;
    }

    this.fetchData();
    // Refrescar cada 10 segundos
    this.refreshInterval = setInterval(() => {
      this.fetchData(false);
    }, 10000);
  }

  ngOnDestroy() {
    this.detenerSeguimiento();
  }

  /**
   * Detiene el polling y destruye el mapa (idempotente).
   * Se usa al finalizar/anular el pedido o cuando el token no es válido.
   */
  private detenerSeguimiento(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
      this.markerCamion = null;
      this.markerDestino = null;
      this.fitBoundsDone = false;
    }
  }

  /** Reintenta la carga desde el estado de error. */
  reintentar() {
    this.error = '';
    this.loading = true;
    this.fetchData(true);
  }

  fetchData(isFirstLoad = true) {
    const url = `/api/rastreo-cliente?token=${this.token}`;
    this.http.get(url).subscribe({
      next: (data: any) => {
        // Normalizar fechas para Safari (reemplazar espacio por T en timestamps SQL)
        if (typeof data.fecha_pedido === 'string') data.fecha_pedido = data.fecha_pedido.replace(' ', 'T');
        if (Array.isArray(data.eventos)) {
          data.eventos.forEach((evento: any) => {
            if (typeof evento?.timestamp === 'string') evento.timestamp = evento.timestamp.replace(' ', 'T');
          });
        }
        if (typeof data.gps_actual?.timestamp === 'string') {
            data.gps_actual.timestamp = data.gps_actual.timestamp.replace(' ', 'T');
        }

        // Evitar el parpadeo comparando el JSON stringificado (sin gps_actual para evitar re-renderizados bruscos de UI si solo cambia el GPS)
        const newStr = JSON.stringify({ ...data, gps_actual: null });
        const oldStr = JSON.stringify({ ...this.trackingData, gps_actual: null });

        if (newStr !== oldStr) {
          // Usar Object.assign en lugar de reemplazar la referencia completa del objeto.
          // Si reasignamos this.trackingData = data, Angular detecta un nuevo objeto y destruye
          // y recrea TODOS los *ngFor del template, causando el parpadeo visual evidente.
          // Con Object.assign actualizamos las propiedades en el mismo objeto, sin cambiar la referencia.
          if (!this.trackingData) {
            this.trackingData = data;
          } else {
            Object.assign(this.trackingData, data);
          }

        } else if (data.gps_actual) {
          // Si solo cambió el GPS, actualizarlo sin perder referencia del objeto
          this.trackingData.gps_actual = data.gps_actual;
        }

        // Pedido finalizado o anulado: detener polling y limpiar el mapa
        if (this.trackingData.estado === 'COMPLETADA' || this.trackingData.estado === 'ANULADA') {
          this.detenerSeguimiento();
        }

        if (isFirstLoad) {
          this.loading = false;
          // Inicializar mapa un momento después de que la vista cargue
          setTimeout(() => {
            if (this.isDispatched && !this.esCantera && !this.map) {
              this.initMap();
            }
          }, 800); // Dar más tiempo al DOM
        } else {
          // Actualizar mapa si ya existe, si no intentar inicializar
          if (this.map) {
            this.updateMapAndETA();
          } else {
            setTimeout(() => {
              if (this.isDispatched && !this.esCantera && !this.map) {
                this.initMap();
              }
            }, 300);
          }
        }
      },
      error: (err) => {
        console.error(err);
        if (isFirstLoad) {
          this.error = err.error?.error || 'No se pudo cargar la información del pedido. Verifica el enlace de rastreo.';
          this.loading = false;
          // Token inválido o pedido inexistente: no tiene sentido seguir consultando
          if (err.status === 400 || err.status === 404) {
            this.detenerSeguimiento();
          }
        }
      }
    });
  }

  // Lógica del Mapa
  private initMap() {
    // CANTERA es recojo en planta: no hay ruta GPS ni mapa que mostrar.
    if (this.esCantera) return;
    const mapElement = document.getElementById('rastreo-cliente-map');
    if (!mapElement) return;

    const destino = this.getCoordenadasDestino();
    const ultimaPos = this.getUltimaPosicionConocida();
    // Centro inicial: destino > última posición conocida > Lima (fallback)
    const centro = destino ?? ultimaPos ?? { lat: -12.046374, lng: -77.042793 };

    this.map = L.map('rastreo-cliente-map', {
      zoomControl: true,
      attributionControl: true,
      dragging: true,
      scrollWheelZoom: false,
      touchZoom: true
    }).setView([centro.lat, centro.lng], 13);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(this.map);

    // Icono de destino (punto rojo fijo)
    const destIcon = L.divIcon({
      className: '',
      html: `<div style="background:#ef4444;width:22px;height:22px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;">🏁</div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });

    // Icono de origen del viaje (punto verde)
    const origenIcon = L.divIcon({
      className: '',
      html: `<div style="background:#10b981;width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });

    // Marcador de destino (solo si el pedido tiene coordenadas registradas)
    if (destino) {
      this.markerDestino = L.marker([destino.lat, destino.lng], { icon: destIcon }).addTo(this.map)
        .bindTooltip('Destino de entrega', { permanent: false, direction: 'top' });
    }

    // Marcador de origen del despacho (si existe)
    const despacho = this.trackingData.eventos?.find((e: any) => e.tipo === 'DESPACHO_INICIADO' || e.tipo === 'RECEPCION_CHOFER');
    if (despacho?.lat && despacho?.lng) {
      L.marker([parseFloat(despacho.lat), parseFloat(despacho.lng)], { icon: origenIcon }).addTo(this.map!)
        .bindTooltip('Punto de salida', { permanent: false, direction: 'top' });
    }

    // Posición inicial del camión: GPS en vivo > última posición conocida > centro
    const gps = this.trackingData.gps_actual;
    let camionPos = centro;
    let estadoInicial: 'moving' | 'stopped' | 'no_signal' = 'no_signal';
    let edadInicial = 0;
    if (gps?.latitud && gps?.longitud) {
      camionPos = { lat: parseFloat(gps.latitud), lng: parseFloat(gps.longitud) };
      const edad = (Date.now() - new Date(gps.timestamp).getTime()) / 60000;
      edadInicial = edad;
      estadoInicial = edad > 10 ? 'no_signal' : (edad >= 3 ? 'stopped' : 'moving');
    } else if (ultimaPos) {
      camionPos = ultimaPos;
    }
    this.markerCamion = L.marker([camionPos.lat, camionPos.lng], { icon: this.buildClientTruckIcon(estadoInicial, edadInicial) }).addTo(this.map);

    this.updateMapAndETA();
    setTimeout(() => this.map?.invalidateSize(), 500);
  }

  /** Coordenadas de destino registradas en el pedido, o null si no existen. */
  private getCoordenadasDestino(): { lat: number; lng: number } | null {
    const lat = this.trackingData?.lat_destino ? parseFloat(this.trackingData.lat_destino) : null;
    const lng = this.trackingData?.lng_destino ? parseFloat(this.trackingData.lng_destino) : null;
    if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
      return { lat, lng };
    }
    return null;
  }

  /** Última posición conocida (despacho/recepción) por timestamp, o null. */
  private getUltimaPosicionConocida(): { lat: number; lng: number } | null {
    if (!this.trackingData?.eventos) return null;
    const conPos = this.trackingData.eventos
      .filter((e: any) => e.lat !== null && e.lat !== undefined && e.lng !== null && e.lng !== undefined)
      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const ultimo = conPos[conPos.length - 1];
    if (!ultimo) return null;
    const lat = parseFloat(ultimo.lat);
    const lng = parseFloat(ultimo.lng);
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat, lng };
  }

  private updateMapAndETA() {
    if (this.esCantera) return;
    if (!this.map || !this.trackingData || !this.markerCamion) return;

    const destino = this.getCoordenadasDestino();
    const ultimaPos = this.getUltimaPosicionConocida();

    // Posición del camión: GPS en vivo > última posición conocida
    const gps = this.trackingData.gps_actual;
    const gpsDisponible = !!(gps?.latitud && gps?.longitud);
    let latC: number | null = null;
    let lngC: number | null = null;
    let lastUpdate = new Date(this.trackingData.fecha_pedido || Date.now());

    if (gpsDisponible) {
      latC = parseFloat(gps.latitud);
      lngC = parseFloat(gps.longitud);
      lastUpdate = new Date(gps.timestamp);
    } else if (ultimaPos) {
      latC = ultimaPos.lat;
      lngC = ultimaPos.lng;
    }

    if (latC === null || lngC === null) return;

    // Determinar estado del camión según antigüedad del GPS
    const edadMin = (Date.now() - lastUpdate.getTime()) / 60000;
    let markerState: 'moving' | 'stopped' | 'no_signal';
    if (!gpsDisponible || edadMin > 10) {
      markerState = 'no_signal';
    } else if (edadMin >= 3) {
      markerState = 'stopped';
    } else {
      markerState = 'moving';
    }

    // Mover marcador y actualizar ícono según estado
    this.markerCamion.setLatLng([latC, lngC]);
    this.markerCamion.setIcon(this.buildClientTruckIcon(markerState, edadMin));

    // Ajustar vista para que se vean camión y destino — SOLO en la primera carga
    // para no resetear el zoom si el usuario ha hecho zoom manual.
    if (!this.fitBoundsDone && destino && (latC !== destino.lat || lngC !== destino.lng)) {
      const bounds = L.latLngBounds([[latC, lngC], [destino.lat, destino.lng]]);
      this.map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
      this.fitBoundsDone = true;
    }

    // ETA solo si hay coordenadas de destino y el viaje activo está EN RUTA
    const viajeActivo = this.viajeActivo;
    if (!destino || !viajeActivo || !viajeActivo.enRuta || viajeActivo.entregado) {
      this.etaInfo = null;
    } else {
      this.calculateETA(latC, lngC, destino.lat, destino.lng, lastUpdate, gpsDisponible);
    }
  }


  private calculateETA(latC: number, lngC: number, latD: number, lngD: number, lastUpdate: Date, gpsDisponible: boolean) {
    const distanciaKm = this.getDistanceFromLatLonInKm(latC, lngC, latD, lngD);
    const ahora = new Date();
    const difMinutos = (ahora.getTime() - lastUpdate.getTime()) / 60000;
    const esEstimado = !gpsDisponible || difMinutos > 5;

    const velKmh = 35; // Velocidad urbana promedio asumida
    const horasRestantes = distanciaKm / velKmh;
    const fechaLlegada = new Date(ahora.getTime() + horasRestantes * 3600000);

    const formatoLlegada = fechaLlegada.toLocaleTimeString('es-PE', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Lima'
    });

    // Día de llegada en hora de Perú (hoy / mañana / fecha corta)
    const fmtDia = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
    const hoyLima = fmtDia(ahora);
    const mananaLima = fmtDia(new Date(ahora.getTime() + 24 * 3600000));
    const llegadaLima = fmtDia(fechaLlegada);
    let etaDia: string;
    if (llegadaLima === hoyLima) {
      etaDia = 'hoy';
    } else if (llegadaLima === mananaLima) {
      etaDia = 'mañana';
    } else {
      etaDia = fechaLlegada.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', timeZone: 'America/Lima' });
    }

    this.etaInfo = {
      eta: formatoLlegada,
      etaDia,
      distanciaKm: distanciaKm.toFixed(1),
      esEstimado: esEstimado,
      edadMin: Math.floor(difMinutos)
    };
  }


  private getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371; // Radius of the earth in km
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  private deg2rad(deg: number) { return deg * (Math.PI/180); }

  get isDelivered(): boolean { return this.trackingData?.estado === 'COMPLETADA'; }

  /** El pedido es de modalidad CANTERA (recojo en planta): no hay ruta GPS ni ETA de llegada. */
  get esCantera(): boolean {
    return this.trackingData?.lugar_entrega === 'CANTERA';
  }

  /** Título principal de estado según la modalidad del pedido. */
  get estadoTitulo(): string {
    if (!this.trackingData) return '';
    if (this.esCantera) {
      return this.isDelivered
        ? 'Pedido Recogido en Planta'
        : (this.isDispatched ? 'Listo para Recojo en Planta' : 'Preparando tu Pedido para Recojo');
    }
    return this.isDelivered ? 'Entregado con Éxito' : (this.isDispatched ? 'Pedido en Camino' : 'Preparando Despacho');
  }

  get eventosFiltrados(): any[] {
    if (!this.trackingData?.eventos) return [];
    return this.trackingData.eventos
      .filter((e: any) => e.tipo === 'DESPACHO_INICIADO' || e.tipo === 'ENTREGA_REALIZADA' || e.tipo === 'RECEPCION_CHOFER')
      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  // Cache para evitar que viajesAgrupados devuelva objetos nuevos en cada ciclo de change detection,
  // lo que causaba que *ngFor destruyera y recreara el DOM provocando el parpadeo visible.
  private _cachedViajesKey: string = '';
  private _cachedViajes: any[] = [];

  get viajesAgrupados(): any[] {
    const eventos = this.eventosFiltrados;
    const key = eventos.map((e: any) => `${e.tipo}|${e.timestamp}|${e.id}`).join(',');
    if (key === this._cachedViajesKey) return this._cachedViajes;
    this._cachedViajesKey = key;

    if (!eventos || eventos.length === 0) {
      this._cachedViajes = [];
      return this._cachedViajes;
    }

    const viajesMap: { [key: number]: any } = {};
    let viajeSecuencial = 1;

    eventos.forEach((e: any) => {
      const match = e.detalle?.match(/#(\d+)/);
      let num = match ? parseInt(match[1], 10) : null;
      if (!num) {
        num = viajeSecuencial;
        if (e.tipo === 'ENTREGA_REALIZADA') viajeSecuencial++;
      }
      if (!viajesMap[num]) {
        viajesMap[num] = { numero: num, eventos: [], despachado: false, enRuta: false, entregado: false, items: null, placa: null, chofer: null, despachador: null };
      }
      viajesMap[num].eventos.push(e);
      if (e.placa_vehiculo) viajesMap[num].placa = e.placa_vehiculo;
      if (e.chofer_nombre) viajesMap[num].chofer = e.chofer_nombre;
      if (e.despachador) viajesMap[num].despachador = e.despachador;
      if (e.tipo === 'DESPACHO_INICIADO') { viajesMap[num].despachado = true; if (e.items) viajesMap[num].items = e.items; }
      if (e.tipo === 'RECEPCION_CHOFER')  { viajesMap[num].enRuta = true; }
      if (e.tipo === 'ENTREGA_REALIZADA') { viajesMap[num].entregado = true; }
    });

    // En pedidos CANTERA no hay chofer de reparto: el responsable es el
    // despachador de planta (viene a nivel de pedido en el payload).
    Object.values(viajesMap).forEach((v: any) => {
      if (!v.despachador) v.despachador = this.trackingData?.despachador || null;
    });

    this._cachedViajes = Object.values(viajesMap).sort((a: any, b: any) => a.numero - b.numero);
    return this._cachedViajes;
  }

  get viajeActivo(): any | null {
    return this.viajesAgrupados.find(v => !v.entregado) || null;
  }

  get viajesHistoricos(): any[] {
    return this.viajesAgrupados.filter(v => v.entregado).sort((a: any, b: any) => b.numero - a.numero);
  }

  /** Para el mapa: solo si hay un viaje activo en curso (no entregado). */
  get isDispatched(): boolean {
    return this.viajeActivo !== null && (this.viajeActivo.despachado || this.viajeActivo.enRuta);
  }

  /** Para el stepper: permanece true incluso cuando todos los viajes ya fueron entregados. */
  get hasBeenDispatched(): boolean {
    return this.viajesAgrupados.some(v => v.despachado || v.entregado);
  }

  /** Indica si la función devolvió una posición GPS en vivo del chofer. */
  get gpsDisponible(): boolean {
    return !!(this.trackingData?.gps_actual?.latitud && this.trackingData?.gps_actual?.longitud);
  }

  abrirEvidencia(url: string) { if (url) window.open(url, '_blank'); }
  trackByEventId(index: number, evento: any): string { return evento.id || (evento.tipo + evento.timestamp); }
  trackByViajeNum(index: number, viaje: any): number { return viaje.numero; }

  // ─── Helpers de ícono de camión en vivo (compartidos con logistica) ───────────

  /**
   * Ícono de camión con textos pensados para el cliente final.
   * La lógica compartida (CSS + construcción del ícono) vive en shared/utils/live-truck-marker.ts.
   */
  private buildClientTruckIcon(state: LiveTruckState, edadMin: number): L.DivIcon {
    const safeEdad = Number.isFinite(edadMin) && edadMin >= 0 ? Math.round(edadMin) : 0;
    return buildLiveTruckIcon(state, edadMin, {
      stopped:   `⏸ Lento/detenido · ${safeEdad}m`,
      no_signal: safeEdad > 0 ? `📡 Sin señal · ${safeEdad}m` : '📡 Sin señal'
    });
  }
}
