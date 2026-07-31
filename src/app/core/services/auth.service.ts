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
