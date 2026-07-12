import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { HttpClient, HttpClientModule } from '@angular/common/http';

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
  }

  fetchData(isFirstLoad = true) {
    const url = `/api/rastreo?token=${this.token}`;
    this.http.get(url).subscribe({
      next: (data: any) => {
        // Normalizar fechas para Safari (reemplazar espacio por T en timestamps SQL)
        if (data.fecha_pedido) {
          data.fecha_pedido = data.fecha_pedido.replace(' ', 'T');
        }
        if (data.eventos) {
          data.eventos.forEach((evento: any) => {
            if (evento.timestamp) {
              evento.timestamp = evento.timestamp.replace(' ', 'T');
            }
          });
        }

        // Evitar el parpadeo comparando el JSON stringificado
        const newStr = JSON.stringify(data);
        const oldStr = JSON.stringify(this.trackingData);
        if (newStr !== oldStr) {
          this.trackingData = data;
        }

        if (isFirstLoad) {
          this.loading = false;
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

  get isDelivered(): boolean {
    return this.trackingData?.estado === 'COMPLETADA';
  }

  get isDispatched(): boolean {
    return this.trackingData?.eventos?.some((e: any) => e.tipo === 'DESPACHO_INICIADO') || this.isDelivered;
  }

  get eventosFiltrados(): any[] {
    if (!this.trackingData?.eventos) return [];
    
    if (this.trackingData.lugar_entrega === 'CANTERA') {
      return this.trackingData.eventos.filter((e: any) => e.tipo === 'DESPACHO_INICIADO');
    }
    
    if (this.trackingData.lugar_entrega === 'OBRA') {
      return this.trackingData.eventos.filter((e: any) => e.tipo === 'ENTREGA_REALIZADA');
    }
    
    return this.trackingData.eventos;
  }

  get hasPhotos(): boolean {
    const eventos = this.eventosFiltrados;
    if (!eventos || eventos.length === 0) return false;
    return eventos.some((e: any) => e.foto || (e.fotos && e.fotos.length > 0));
  }

  abrirEvidencia(url: string) {
    if (url) {
      window.open(url, '_blank');
    }
  }

  trackByEventId(index: number, evento: any): string {
    // Retorna el ID del evento o un hash de sus propiedades si no tiene ID
    return evento.id || (evento.tipo + evento.timestamp);
  }
}
