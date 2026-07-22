import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { createClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { DropdownModule } from 'primeng/dropdown';
import { TabViewModule } from 'primeng/tabview';
import { TagModule } from 'primeng/tag';
import { FileUploadModule } from 'primeng/fileupload';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'app-configuracion',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    InputTextareaModule,
    DropdownModule,
    TabViewModule,
    TagModule,
    FileUploadModule,
    TooltipModule
  ],
  templateUrl: './configuracion.component.html',
  styleUrl: './configuracion.component.scss'
})
export class ConfiguracionComponent implements OnInit {
  supabaseService = inject(SupabaseService);
  supabase = this.supabaseService.client;

  // Secundary Client for User Creation (prevents logout of Admin)
  adminSupabase = createClient(environment.supabaseUrl, environment.supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  // Usuarios Tab
  usuarios: any[] = [];
  loadingUsuarios = false;
  displayUserModal = false;
  isSavingUser = false;
  
  roles = [
    { label: 'Vendedor', value: 'vendedor' },
    { label: 'Despachador', value: 'despachador' },
    { label: 'Chofer', value: 'chofer' },
    { label: 'Administrador', value: 'admin' }
  ];

  nuevoUsuario = {
    email: '',
    password: '',
    nombre_completo: '',
    rol: 'vendedor'
  };
  isEditingUser = false;
  usuarioEditId: string | null = null;

  // Empresa Tab
  empresa: any = {
    id: 1,
    razon_social: '',
    ruc: '',
    direccion_fiscal: '',
    cuentas_bancarias_json: [],
    logo_url: '',
    telefonos: '',
    correo: '',
    color_hex: '#01696f'
  };
  isSavingEmpresa = false;

  agregarCuentaBancaria() {
    if (!this.empresa.cuentas_bancarias_json) {
      this.empresa.cuentas_bancarias_json = [];
    }
    this.empresa.cuentas_bancarias_json.push({ banco: '', moneda: 'PEN', numero_cuenta: '', cci: '' });
  }

  eliminarCuentaBancaria(index: number) {
    this.empresa.cuentas_bancarias_json.splice(index, 1);
  }

  async ngOnInit() {
    await Promise.all([
      this.loadUsuarios(),
      this.loadEmpresa()
    ]);
  }

  // --- LOGICA DE USUARIOS ---
  async loadUsuarios() {
    this.loadingUsuarios = true;
    try {
      const { data, error } = await this.supabase
        .from('usuarios')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (!error) {
        this.usuarios = data || [];
      } else {
        console.warn('Error cargando usuarios:', error.message);
      }
    } catch(e) {
      console.warn('Excepción cargando usuarios:', e);
    }
    this.loadingUsuarios = false;
  }

  abrirNuevoUsuario() {
    this.isEditingUser = false;
    this.usuarioEditId = null;
    this.nuevoUsuario = {
      email: '',
      password: '',
      nombre_completo: '',
      rol: 'vendedor'
    };
    this.displayUserModal = true;
  }

  editarUsuario(usuario: any) {
    this.isEditingUser = true;
    this.usuarioEditId = usuario.id;
    this.nuevoUsuario = {
      email: usuario.correo,
      password: '', // Password cannot be edited from here easily
      nombre_completo: usuario.nombre_completo || '',
      rol: usuario.rol
    };
    this.displayUserModal = true;
  }

  async guardarUsuario() {
    if (!this.isEditingUser && (!this.nuevoUsuario.email || !this.nuevoUsuario.password)) {
      alert('Correo y Contraseña son obligatorios para crear un usuario nuevo.');
      return;
    }

    if (!this.nuevoUsuario.nombre_completo) {
        alert('El Nombre Completo es obligatorio.');
        return;
    }

    this.isSavingUser = true;
    try {
      if (this.isEditingUser && this.usuarioEditId) {
        // Actualizar solo nombre y rol en la tabla public.usuarios
        const { error } = await this.supabase
          .from('usuarios')
          .update({
            nombre_completo: this.nuevoUsuario.nombre_completo,
            rol: this.nuevoUsuario.rol
          })
          .eq('id', this.usuarioEditId);

        if (error) throw error;
        alert('Usuario actualizado correctamente.');
      } else {
        // Create user via Supabase Auth without interrupting current session
        const { data, error } = await this.adminSupabase.auth.signUp({
          email: this.nuevoUsuario.email,
          password: this.nuevoUsuario.password,
          options: {
            data: {
              rol: this.nuevoUsuario.rol,
              nombre_completo: this.nuevoUsuario.nombre_completo,
              full_name: this.nuevoUsuario.nombre_completo // Respaldo para triggers estándar
            }
          }
        });

        if (error) throw error;
        
        // Forzar actualización directa en public.usuarios para asegurar que el nombre se guarde
        if (data.user) {
          const { error: updateError } = await this.supabase
            .from('usuarios')
            .update({
              nombre_completo: this.nuevoUsuario.nombre_completo,
              rol: this.nuevoUsuario.rol
            })
            .eq('id', data.user.id);
            
          if (updateError) {
             console.warn('Aviso: No se pudo forzar el nombre en public.usuarios', updateError);
          }
        }
        alert('Usuario creado correctamente. El vendedor/despachador ya puede iniciar sesión.');
      }

      this.displayUserModal = false;
      await this.loadUsuarios();
    } catch (error: any) {
      alert('Error al guardar usuario: ' + error.message);
    } finally {
      this.isSavingUser = false;
    }
  }

  async toggleUserStatus(usuario: any) {
    const newStatus = !usuario.activo;
    const { error } = await this.supabase
      .from('usuarios')
      .update({ activo: newStatus })
      .eq('id', usuario.id);
      
    if (!error) {
      usuario.activo = newStatus;
    } else {
      alert('Error al cambiar el estado del usuario');
    }
  }

  // --- LOGICA DE EMPRESA ---
  async loadEmpresa() {
    try {
      const { data, error } = await this.supabase
        .from('configuracion_empresa')
        .select('*')
        .eq('id', 1)
        .single();
      
      if (data) {
        this.empresa = data;
      } else {
        console.warn('No se encontraron datos de empresa. Se usarán datos por defecto o la tabla no existe.');
      }
    } catch(e) {
      console.warn('Excepción cargando empresa:', e);
    }
  }

  async guardarEmpresa() {
    this.isSavingEmpresa = true;
    try {
      const { error } = await this.supabase
        .from('configuracion_empresa')
        .upsert(this.empresa);
        
      if (error) throw error;
      alert('Datos de empresa actualizados correctamente.');
    } catch (error: any) {
      alert('Error al guardar datos de la empresa: ' + error.message);
    } finally {
      this.isSavingEmpresa = false;
    }
  }

  async uploadLogo(event: any, fileUpload: any) {
    const file = event.files[0];
    if (!file) {
      fileUpload.clear();
      return;
    }

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `logo_${new Date().getTime()}.${fileExt}`;
      const filePath = `logos/${fileName}`;

      // Upload to Supabase Storage Bucket "assets"
      const { error: uploadError } = await this.supabase.storage
        .from('assets')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Get Public URL
      const { data } = this.supabase.storage
        .from('assets')
        .getPublicUrl(filePath);

      this.empresa.logo_url = data.publicUrl;
      
      // Auto-save company data after logo upload
      await this.guardarEmpresa();

    } catch (error: any) {
      alert('Error al subir el logo o formato inválido: ' + error.message);
    } finally {
      // ALWAYS clear the file upload so the user can try another file without refreshing
      fileUpload.clear();
    }
  }
}
