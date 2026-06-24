import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { InventarioService } from '../../core/services/inventario.service';

import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DropdownModule } from 'primeng/dropdown';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';

@Component({
  selector: 'app-catalogo',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    InputNumberModule,
    DropdownModule,
    CardModule,
    TagModule
  ],
  templateUrl: './catalogo.component.html',
  styleUrl: './catalogo.component.scss'
})
export class CatalogoComponent implements OnInit {
  supabase = inject(SupabaseService).client;
  inventarioService = inject(InventarioService);

  productos: any[] = [];
  loading = false;

  displayModal = false;
  isSaving = false;
  isGeneratingSku = false;
  
  unidadesMedida = [
    { label: 'M3 (Metros Cúbicos)', value: 'M3' },
    { label: 'TN (Toneladas)', value: 'TN' },
    { label: 'BLS (Bolsas)', value: 'BLS' },
    { label: 'UND (Unidad/Pieza)', value: 'UND' },
    { label: 'KG (Kilogramos)', value: 'KG' },
    { label: 'GLN (Galones)', value: 'GLN' },
    { label: 'VIAJE (Fletes/Viajes)', value: 'VIAJE' },
    { label: 'SERVICIO (General)', value: 'SERVICIO' }
  ];

  tiposInventario = [
    { label: 'A Granel (Estimado)', value: 'GRANEL_ESTIMADO' },
    { label: 'Empaquetado (Exacto)', value: 'EMPAQUETADO_EXACTO' }
  ];

  nuevoProducto: any = {
    id: null,
    codigo_sku: '',
    descripcion: '',
    unidad_medida: 'UND',
    precio_unitario_base: null,
    tipo_inventario: 'GRANEL_ESTIMADO',
    stock_actual: null,
    stock_minimo: 0
  };

  async ngOnInit() {
    await this.loadProductos();
  }

  async loadProductos() {
    this.loading = true;
    const { data, error } = await this.supabase
      .from('productos')
      .select('*')
      .order('descripcion', { ascending: true });
    
    if (!error) {
      this.productos = data || [];
    }
    this.loading = false;
  }

  async abrirNuevo() {
    this.nuevoProducto = {
      id: null,
      codigo_sku: 'Generando...',
      descripcion: '',
      unidad_medida: 'UND',
      precio_unitario_base: null,
      tipo_inventario: 'GRANEL_ESTIMADO',
      stock_actual: null,
      stock_minimo: 0
    };
    this.displayModal = true;
  }

  abrirEditar(producto: any) {
    this.nuevoProducto = { ...producto };
    this.displayModal = true;
  }

  async eliminarProducto(producto: any) {
    if (confirm(`¿Estás seguro de eliminar el producto ${producto.descripcion}?`)) {
      try {
        const { error } = await this.supabase
          .from('productos')
          .delete()
          .eq('id', producto.id);
        
        if (error) throw error;
        await this.loadProductos();
      } catch (error: any) {
        alert('Error al eliminar: No se puede eliminar un producto si ya tiene movimientos o ventas.');
      }
    }
  }



  async guardarProducto() {
    if (!this.nuevoProducto.descripcion) {
      alert('La descripción es obligatoria');
      return;
    }

    this.isSaving = true;
    try {
      if (this.nuevoProducto.id) {
        // EDIT
        const { id, created_at, ...updateData } = this.nuevoProducto;
        const { error } = await this.supabase
          .from('productos')
          .update(updateData)
          .eq('id', id);
        if (error) throw error;
      } else {
        // INSERT
        const { id, stock_actual, codigo_sku, ...insertData } = this.nuevoProducto;
        const dataToInsert = { ...insertData, stock_actual: 0 }; // Initialize at 0 to use history
        
        const { data: insertedProd, error } = await this.supabase
          .from('productos')
          .insert(dataToInsert)
          .select('id')
          .single();
          
        if (error) throw error;
        
        // Log history if initial stock was provided
        if (stock_actual && stock_actual > 0) {
            await this.inventarioService.registrarMovimientoManual(
                insertedProd.id, 
                'ENTRADA', 
                stock_actual, 
                'Inventario Inicial'
            );
        }
      }
      
      this.displayModal = false;
      await this.loadProductos();
    } catch (error: any) {
      alert('Error al guardar: ' + error.message);
    } finally {
      this.isSaving = false;
    }
  }
}
