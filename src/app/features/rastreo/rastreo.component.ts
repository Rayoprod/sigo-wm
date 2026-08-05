import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import * as L from 'leaflet';

@Component({
  selector: 'app-rastreo',
  standalone: true,
  imports: [CommonModule, HttpClientModule],
  templateUrl: './rastreo.component.html',
  styleUrls: ['./rastreo.component.scss']
})
export class RastreoComponent implements OnInit, OnDestroy {
  token: string = '';
  loading: boolean = true;
  error: string = '';
  trackingData: any = null;

  refreshInterval: any;

  // Mapa
  private map: L.Map | null = null;
  private markerCamion: L.Marker | null = null;
  private markerDestino: L.Marker | null = null;
  private polylineRuta: L.Polyline | null = null;
  
  etaInfo: {
    eta: string;
    distanciaKm: string;
    velocidadKmh: string;
    esEstimado: boolean;
    detenido: boolean;
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
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  fetchData(isFirstLoad = true) {
    const url = `/api/rastreo?token=${this.token}`;
    this.http.get(url).subscribe({
      next: (data: any) => {
        // Normalizar fechas para Safari (reemplazar espacio por T en timestamps SQL)
        if (data.fecha_pedido) data.fecha_pedido = data.fecha_pedido.replace(' ', 'T');
        if (data.eventos) {
          data.eventos.forEach((evento: any) => {
            if (evento.timestamp) evento.timestamp = evento.timestamp.replace(' ', 'T');
          });
        }
        if (data.gps_actual && data.gps_actual.timestamp) {
            data.gps_actual.timestamp = data.gps_actual.timestamp.replace(' ', 'T');
        }

        // Evitar el parpadeo comparando el JSON stringificado (sin gps_actual para evitar re-renderizados bruscos de UI si solo cambia el GPS)
        const newStr = JSON.stringify({ ...data, gps_actual: null });
        const oldStr = JSON.stringify({ ...this.trackingData, gps_actual: null });
        
        if (newStr !== oldStr) {
          this.trackingData = data;
        } else if (data.gps_actual) {
          // Si solo cambió el GPS, actualizarlo sin perder referencia del objeto
          this.trackingData.gps_actual = data.gps_actual;
        }

        // Si el estado es anulado, detener el polling y limpiar mapa
        if (this.trackingData.estado === 'ANULADA') {
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
                this.refreshInterval = null;
            }
            if (this.map) {
                this.map.remove();
                this.map = null;
            }
        }

        if (isFirstLoad) {
          this.loading = false;
          // Inicializar mapa un momento después de que la vista cargue
          setTimeout(() => {
            if (this.isDispatched && !this.isDelivered && this.trackingData.lat_destino && this.trackingData.lng_destino) {
              this.initMap();
            }
          }, 500);
        } else {
          // Actualizar mapa si ya existe
          if (this.map) {
            this.updateMapAndETA();
          }
        }
      },
      error: (err) => {
        console.error(err);
        if (isFirstLoad) {
          this.error = err.error?.error || 'No se pudo cargar la información del pedido. Verifica que el folio sea correcto.';
          this.loading = false;
        }
      }
    });
  }

  // Lógica del Mapa
  private initMap() {
    const mapElement = document.getElementById('rastreo-map');
    if (!mapElement) return;

    const latD = parseFloat(this.trackingData.lat_destino);
    const lngD = parseFloat(this.trackingData.lng_destino);

    this.map = L.map('rastreo-map', {
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: false, // Mejor experiencia en móviles
      touchZoom: true
    }).setView([latD, lngD], 14);

    // Usar Voyager de CARTO
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { 
        subdomains: 'abcd', maxZoom: 22, maxNativeZoom: 19
    }).addTo(this.map);

    // Marcador de Destino
    const destinoIcon = L.divIcon({
      html: `<div class="destination-marker"><i class="pi pi-home"></i></div>`,
      className: 'custom-div-icon',
      iconSize: [40, 40],
      iconAnchor: [20, 40]
    });
    this.markerDestino = L.marker([latD, lngD], { icon: destinoIcon }).addTo(this.map);

    // Camión
    const camionIcon = L.divIcon({
      html: `<div class="truck-marker pulse-animation"><i class="pi pi-truck"></i></div>`,
      className: 'custom-div-icon',
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });
    this.markerCamion = L.marker([latD, lngD], { icon: camionIcon }).addTo(this.map);

    this.polylineRuta = L.polyline([], { color: '#3b82f6', weight: 4, dashArray: '5, 10' }).addTo(this.map);

    this.updateMapAndETA();
  }

  private updateMapAndETA() {
    if (!this.map || !this.trackingData || !this.trackingData.lat_destino || !this.trackingData.lng_destino || !this.markerCamion) return;

    const latD = parseFloat(this.trackingData.lat_destino);
    const lngD = parseFloat(this.trackingData.lng_destino);

    let latC = -12.046374; // Base cantera por defecto
    let lngC = -77.042793;
    let lastUpdate = new Date();
    let estadoVehiculo = 'EN_CAMINO';
    let gpsDisponible = false;

    if (this.trackingData.gps_actual) {
      const gps = this.trackingData.gps_actual;
      latC = parseFloat(gps.latitud);
      lngC = parseFloat(gps.longitud);
      lastUpdate = new Date(gps.timestamp);
      estadoVehiculo = gps.vehiculo_estado;
      gpsDisponible = true;
    }

    // Mover camión de forma suave
    this.markerCamion.setLatLng([latC, lngC]);
    if (!gpsDisponible) {
        this.markerCamion.setOpacity(0.5);
    } else {
        this.markerCamion.setOpacity(1);
    }
    
    this.polylineRuta?.setLatLngs([[latC, lngC], [latD, lngD]]);

    // Reajustar vista para que se vean ambos
    const bounds = L.latLngBounds([[latC, lngC], [latD, lngD]]);
    this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });

    this.calculateETA(latC, lngC, latD, lngD, lastUpdate, estadoVehiculo, gpsDisponible);
  }

  private calculateETA(latC: number, lngC: number, latD: number, lngD: number, lastUpdate: Date, estadoVehiculo: string, gpsDisponible: boolean) {
    const distanciaKm = this.getDistanceFromLatLonInKm(latC, lngC, latD, lngD);
    const ahora = new Date();
    const difMinutos = (ahora.getTime() - lastUpdate.getTime()) / 60000;
    
    // Si la señal es vieja (> 5 min) o dice detenido, usar vel. promedio
    const detenido = gpsDisponible && (estadoVehiculo === 'DETENIDO' || difMinutos > 5);
    const velKmh = detenido ? 0 : 35; // Asumimos 35km/h urbano si está en movimiento para el cálculo del cliente

    let horasRestantes = 0;
    if (velKmh > 0) {
      horasRestantes = distanciaKm / velKmh;
    } else {
      // Si está detenido, calcular con velocidad promedio para dar una idea, pero marcar en naranja
      horasRestantes = distanciaKm / 35; 
    }

    const fechaLlegada = new Date(ahora.getTime() + horasRestantes * 3600000);
    const formatoLlegada = fechaLlegada.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    this.etaInfo = {
      eta: formatoLlegada,
      distanciaKm: distanciaKm.toFixed(1),
      velocidadKmh: velKmh.toFixed(0),
      esEstimado: !gpsDisponible || detenido,
      detenido: detenido,
      edadMin: gpsDisponible ? Math.floor(difMinutos) : 0
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
  get isDispatched(): boolean { return this.trackingData?.eventos?.some((e: any) => e.tipo === 'DESPACHO_INICIADO') || this.isDelivered; }

  get eventosFiltrados(): any[] {
    if (!this.trackingData?.eventos) return [];
    if (this.trackingData.lugar_entrega === 'CANTERA') return this.trackingData.eventos.filter((e: any) => e.tipo === 'DESPACHO_INICIADO');
    if (this.trackingData.lugar_entrega === 'OBRA') return this.trackingData.eventos.filter((e: any) => e.tipo === 'ENTREGA_REALIZADA');
    return this.trackingData.eventos;
  }

  get hasPhotos(): boolean {
    const eventos = this.eventosFiltrados;
    if (!eventos || eventos.length === 0) return false;
    return eventos.some((e: any) => e.foto || (e.fotos && e.fotos.length > 0));
  }

  abrirEvidencia(url: string) { if (url) window.open(url, '_blank'); }
  trackByEventId(index: number, evento: any): string { return evento.id || (evento.tipo + evento.timestamp); }
}
