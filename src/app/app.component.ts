import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet, Router, RouteConfigLoadStart, RouteConfigLoadEnd, NavigationStart, NavigationEnd, NavigationCancel, NavigationError } from '@angular/router';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { SupabaseService } from './core/services/supabase.service';
import { ThemeService } from './core/services/theme.service';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  title = 'W&M';
  private swUpdate = inject(SwUpdate);
  private router = inject(Router);
  private messageService = inject(MessageService);
  private supabase = inject(SupabaseService).client;
  private themeService = inject(ThemeService); // Instantiates and applies theme

  isNavigating = false;

  constructor() {
    this.router.events.subscribe(event => {
      if (event instanceof RouteConfigLoadStart || event instanceof NavigationStart) {
        this.isNavigating = true;
      } else if (
        event instanceof RouteConfigLoadEnd || 
        event instanceof NavigationEnd || 
        event instanceof NavigationCancel || 
        event instanceof NavigationError
      ) {
        // Un pequeño delay para que la transición sea suave y no un parpadeo molestoso
        setTimeout(() => this.isNavigating = false, 300);
      }
    });

    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates
        .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
        .subscribe(() => {
          // Cuando hay nueva versión descargada en background
          if (confirm('🚀 Hay una nueva versión de W&M disponible con mejoras. ¿Deseas actualizar la aplicación ahora?')) {
            window.location.reload();
          }
        });
    }
  }

  ngOnInit() {
    this.setupRealtimeNotifications();
  }

  setupRealtimeNotifications() {
    // Escuchar tabla pedidos
    this.supabase.channel('custom-pedidos-channel')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pedidos' },
        (payload) => {
          this.messageService.add({
            severity: 'info',
            summary: '¡Nueva Venta!',
            detail: `Se ha registrado el pedido ${payload.new['folio']}`,
            life: 5000
          });
          this.playNotificationSound();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pedidos' },
        (payload) => {
          if (payload.new['estado'] === 'APROBADA') {
            this.messageService.add({
              severity: 'success',
              summary: 'Venta Aprobada',
              detail: `El pedido ${payload.new['folio']} pasó a producción/despacho.`,
              life: 5000
            });
            this.playNotificationSound();
          }
        }
      )
      .subscribe();

    // Escuchar tabla despachos
    this.supabase.channel('custom-despachos-channel')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'despachos_viajes_cabecera' },
        (payload) => {
          if (payload.new['estado_viaje'] === 'COMPLETADO') {
            this.messageService.add({
              severity: 'info',
              summary: 'Despacho Completado',
              detail: `El equipo de logística ha entregado el pedido.`,
              life: 5000
            });
            this.playNotificationSound();
          }
        }
      )
      .subscribe();
  }

  playNotificationSound() {
    // Sonido simple usando la Web Audio API para no depender de archivos externos
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // Nota A5
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      
      oscillator.start();
      gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.5);
      oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
      console.error('No se pudo reproducir el sonido', e);
    }
  }
}
