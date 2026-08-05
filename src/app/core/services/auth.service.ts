import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { User, Session } from '@supabase/supabase-js';
import { Router } from '@angular/router';

export interface AppUser {
  id: string;
  correo: string;
  nombre_completo?: string;
  rol: string[];
  activo: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly supabase = this.supabaseService.client;
  
  currentUser = signal<AppUser | null>(null);
  session = signal<Session | null>(null);

  private sessionInitialized = false;
  private sessionPromise: Promise<void>;
  private sessionResolve!: () => void;

  constructor(
    private supabaseService: SupabaseService,
    private router: Router
  ) {
    this.sessionPromise = new Promise((resolve) => {
      this.sessionResolve = resolve;
    });
    this.initSession();
    this.startKeepAlive();
  }

  /**
   * Keep-alive proactivo: refresca la sesión cada 45 minutos.
   * Esto evita que el JWT expire si el navegador congela la pestaña
   * (Tab Throttling en Chrome cuando la ventana está en segundo plano).
   * Supabase tiene autoRefreshToken pero depende de timers JS que pueden
   * ser suspendidos por el navegador. Este método es el respaldo explícito.
   */
  private startKeepAlive() {
    const INTERVALO_MS = 45 * 60 * 1000; // 45 minutos
    setInterval(async () => {
      const { data: { session } } = await this.supabase.auth.getSession();
      if (session) {
        const { error } = await this.supabase.auth.refreshSession();
        if (error) {
          console.warn('[AuthService] Keep-alive refresh failed:', error.message);
        } else {
          console.log('[AuthService] Keep-alive: sesión renovada correctamente.');
        }
      }
    }, INTERVALO_MS);
  }


  async waitForAuth() {
    if (!this.sessionInitialized) {
      await this.sessionPromise;
    }
    return this.currentUser();
  }

  private async initSession() {
    const { data: { session } } = await this.supabase.auth.getSession();
    this.session.set(session);
    if (session?.user) {
      await this.loadAppUser(session.user.id);
    }
    
    this.sessionInitialized = true;
    this.sessionResolve();

    this.supabase.auth.onAuthStateChange(async (event, session) => {
      // Si el evento es SIGNED_OUT, verificamos si la sesión realmente terminó.
      // Esto previene que un cliente Supabase secundario (adminSupabase en configuracion)
      // dispare un cierre de sesión falso en el cliente principal.
      if (event === 'SIGNED_OUT') {
        const { data: { session: realSession } } = await this.supabase.auth.getSession();
        if (realSession) {
          // La sesión sigue activa — el evento SIGNED_OUT fue espurio (cliente secundario).
          // No hacer nada.
          console.warn('[AuthService] SIGNED_OUT event ignored — real session still active.');
          return;
        }
        this.session.set(null);
        this.currentUser.set(null);
        this.router.navigate(['/login'], { replaceUrl: true });
        return;
      }

      this.session.set(session);
      if (session?.user) {
        await this.loadAppUser(session.user.id);
      } else {
        this.currentUser.set(null);
        // replaceUrl: true reemplaza la entrada actual del historial con /login,
        // impidiendo que el botón "Atrás" del navegador muestre el panel tras cerrar sesión.
        this.router.navigate(['/login'], { replaceUrl: true });
      }
    });
  }

  private async loadAppUser(userId: string) {
    const { data, error } = await this.supabase
      .from('usuarios')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !data || !data.activo) {
      console.error('Error loading user profile or user inactive', error);
      // If inactive, we should sign out
      if (data && !data.activo) {
        await this.signOut();
      }
      return;
    }

    this.currentUser.set(data as AppUser);
  }

  async signIn(email: string, password: string) {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password
    });
    if (error) throw error;
    
    // Prevent race condition: ensure profile is loaded before returning
    if (data.user) {
      await this.loadAppUser(data.user.id);
    }
    
    return data;
  }

  async signOut() {
    await this.supabase.auth.signOut();
  }

  async createStaffUser(email: string, password: string, roles: string[], nombreCompleto?: string) {
    // Only admins should call this
    const { data, error } = await this.supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          rol: roles,
          nombre_completo: nombreCompleto
        }
      }
    });
    if (error) throw error;
    return data;
  }
}
