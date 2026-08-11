import { Injectable, signal, computed, DestroyRef, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Session } from '@supabase/supabase-js';
import { Router } from '@angular/router';
import { APP_ROLES, AppRole, WEB_ROLES } from '../auth/roles';

export interface AppUser {
  id: string;
  correo: string;
  nombre_completo?: string;
  rol: AppRole[];
  activo: boolean;
  es_superadmin?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly supabase = this.supabaseService.client;
  private readonly destroyRef = inject(DestroyRef);

  currentUser = signal<AppUser | null>(null);
  session = signal<Session | null>(null);

  /** Handle del intervalo keep-alive (LOW: se limpia al destruir el servicio). */
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Computed signal con los roles efectivos del usuario actual.
   * Siempre devuelve un array (nunca null).
   * Centraliza la normalización del campo `rol` que históricamente
   * podía ser string o string[] dependiendo del contexto.
   */
  readonly userRoles = computed<AppRole[]>(() => {
    const user = this.currentUser();
    if (!user?.rol) return [];
    return Array.isArray(user.rol) ? user.rol : [user.rol as AppRole];
  });

  /**
   * ¿El usuario activo es administrador?
   * Admin tiene acceso total en web y acceso implícito a todos los roles mobile.
   */
  readonly isAdmin = computed(() => this.userRoles().includes(APP_ROLES.ADMIN));

  /**
   * ¿El usuario tiene AL MENOS UNO de los roles indicados?
   * Admin siempre retorna true independientemente de qué roles se pasen.
   *
   * Uso: auth.hasRole('vendedor', 'despachador')
   */
  hasRole(...roles: AppRole[]): boolean {
    if (this.isAdmin()) return true; // admin tiene acceso total
    return roles.some(r => this.userRoles().includes(r));
  }

  /**
   * ¿El usuario tiene TODOS los roles indicados?
   * Admin siempre retorna true.
   */
  hasAllRoles(...roles: AppRole[]): boolean {
    if (this.isAdmin()) return true;
    return roles.every(r => this.userRoles().includes(r));
  }

  /**
   * ¿El usuario tiene acceso a la web?
   * Bloquea a los choferes puros (solo mobile).
   */
  hasWebAccess(): boolean {
    return this.hasRole(...WEB_ROLES);
  }

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
    this.keepAliveInterval = setInterval(async () => {
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

    // Limpiar el intervalo cuando el servicio se destruye para evitar fugas
    // de timers (setInterval no se limpia solo al re-crear el servicio).
    this.destroyRef.onDestroy(() => {
      if (this.keepAliveInterval !== null) {
        clearInterval(this.keepAliveInterval);
        this.keepAliveInterval = null;
      }
    });
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
    try {
      await this.supabase.auth.signOut();
    } catch (e) {
      // Ignorar errores de red: igual limpiamos el estado local
      console.warn('[AuthService] signOut server call failed (possibly offline):', e);
    } finally {
      // Siempre limpiar estado local y redirigir, incluso si no hay red
      this.session.set(null);
      this.currentUser.set(null);
      this.router.navigate(['/login'], { replaceUrl: true });
    }
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
