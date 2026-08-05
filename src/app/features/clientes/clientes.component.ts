import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { ApiPeruService } from '../../core/services/api-peru.service';

import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { CardModule } from 'primeng/card';

@Component({
  selector: 'app-clientes',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    CardModule
  ],
  templateUrl: './clientes.component.html',
  styleUrl: './clientes.component.scss'
})
export class ClientesComponent implements OnInit {
  supabase = inject(SupabaseService).client;
  apiPeruService = inject(ApiPeruService);

  clientes: any[] = [];
  loading = false;

  displayModal = false;
  isSaving = false;
  isSearchingDoc = false;
  
  nuevoCliente: any = {
    id: null,
    nombre_razon_social: '',
    documento_identidad: '',
    direccion: '',
    telefono: '',
    correo: ''
  };

  async ngOnInit() {
    await this.loadClientes();
  }

  async loadClientes() {
    this.loading = true;
    const { data, error } = await this.supabase
      .from('clientes')
      .select('*')
      .order('nombre_razon_social', { ascending: true });
    
    if (!error) {
      this.clientes = data || [];
    }
    this.loading = false;
  }

  abrirNuevo() {
    this.nuevoCliente = {
      id: null,
      nombre_razon_social: '',
      documento_identidad: '',
      direccion: '',
      telefono: '',
      correo: ''
    };
    this.displayModal = true;
  }

  abrirEditar(cliente: any) {
    this.nuevoCliente = { ...cliente };
    this.displayModal = true;
  }

  async eliminarCliente(cliente: any) {
    if (confirm(`¿Estás seguro de eliminar el cliente ${cliente.nombre_razon_social}?`)) {
      try {
        const { error } = await this.supabase
          .from('clientes')
          .delete()
          .eq('id', cliente.id);
        
        if (error) throw error;
        await this.loadClientes();
      } catch (error: any) {
        alert('Error al eliminar: No se puede eliminar un cliente si ya tiene pedidos registrados.');
      }
    }
  }

  async buscarDocApiPeru() {
    const doc = this.nuevoCliente.documento_identidad?.trim();
    if (!doc) return;
    if (doc.length !== 8 && doc.length !== 11) {
      alert('El documento debe tener 8 (DNI) u 11 (RUC) dígitos.');
      return;
    }

    this.isSearchingDoc = true;
    try {
      // 1. Verificar si ya existe localmente
      const { data: localData } = await this.supabase
        .from('clientes')
        .select('*')
        .eq('documento_identidad', doc)
        .maybeSingle();

      if (localData && localData.id !== this.nuevoCliente.id) {
        alert('Este documento ya se encuentra registrado en tu base de datos como: ' + localData.nombre_razon_social);
        this.isSearchingDoc = false;
        return;
      }
      const res = await this.apiPeruService.buscarDocumento(doc);
      if (res && res.success !== false) { // Handle both wrapper logic
        const data = res.data ? res.data : res;
        if (doc.length === 8) {
          const paterno = data.apellido_paterno || data.apellidoPaterno || '';
          const materno = data.apellido_materno || data.apellidoMaterno || '';
          this.nuevoCliente.nombre_razon_social = `${data.nombres || ''} ${paterno} ${materno}`.trim();
        } else if (doc.length === 11) {
          this.nuevoCliente.nombre_razon_social = data.nombre_o_razon_social || data.razonSocial || '';
          this.nuevoCliente.direccion = data.direccion_completa || data.direccion || '';
        }
      } else {
        alert(res.message || 'No se encontró información para este documento.');
      }
    } catch (error: any) {
      alert('Error al buscar documento: ' + error.message);
    } finally {
      this.isSearchingDoc = false;
    }
  }

  async guardarCliente() {
    if (!this.nuevoCliente.nombre_razon_social) {
      alert('La razón social es obligatoria');
      return;
    }

    this.isSaving = true;
    try {
      // Verificar si el documento ya está registrado por otro cliente
      if (this.nuevoCliente.documento_identidad) {
        let query = this.supabase
          .from('clientes')
          .select('id, nombre_razon_social')
          .eq('documento_identidad', this.nuevoCliente.documento_identidad.trim());
          
        if (this.nuevoCliente.id) {
          query = query.neq('id', this.nuevoCliente.id);
        }

        const { data: existing } = await query.maybeSingle();

        if (existing) {
          alert('No se puede guardar: El documento ingresado ya pertenece a ' + existing.nombre_razon_social);
          this.isSaving = false;
          return;
        }
      }
      if (this.nuevoCliente.id) {
        // EDIT
        const { id, created_at, ...updateData } = this.nuevoCliente;
        const { error } = await this.supabase
          .from('clientes')
          .update(updateData)
          .eq('id', id);
        if (error) throw error;
      } else {
        // INSERT
        const { id, ...insertData } = this.nuevoCliente;
        const { error } = await this.supabase
          .from('clientes')
          .insert(insertData);
        if (error) throw error;
      }
      
      this.displayModal = false;
      await this.loadClientes();
    } catch (error: any) {
      alert('Error al guardar: ' + error.message);
    } finally {
      this.isSaving = false;
    }
  }
}
