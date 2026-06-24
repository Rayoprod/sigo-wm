import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { InventarioService } from '../../core/services/inventario.service';

import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';
import { CardModule } from 'primeng/card';

@Component({
  selector: 'app-inventario',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    TagModule,
    DialogModule,
    DropdownModule,
    InputNumberModule,
    InputTextModule,
    TooltipModule,
    CardModule
  ],
  templateUrl: './inventario.component.html',
  styleUrl: './inventario.component.scss'
})
export class InventarioComponent implements OnInit {
  supabase = inject(SupabaseService).client;
  inventarioService = inject(InventarioService);

  productos: any[] = [];
  loading = false;

  displayModal = false;
  isSaving = false;
  productoSeleccionado: any = null;

  displayMinimoModal = false;
  minimoForm = { id: '', stock_minimo: 0 };
  isSavingMinimo = false;

  displayHistorialModal = false;
  loadingHistorial = false;
  historial: any[] = [];
  productoHistorialSeleccionado: any = null;

  ajuste = {
    tipo: 'ENTRADA',
    cantidad: 0,
    motivo: ''
  };

  tiposMovimiento = [
    { label: 'Entrada (Suma)', value: 'ENTRADA' },
    { label: 'Salida / Merma (Resta)', value: 'SALIDA_MANUAL' }
  ];

  async ngOnInit() {
    await this.cargarInventario();
  }

  async cargarInventario() {
    this.loading = true;
    const { data, error } = await this.supabase
      .from('productos')
      .select('*')
      .order('descripcion');

    if (!error) {
      this.productos = data || [];
    }
    this.loading = false;
  }

  abrirAjuste(producto: any) {
    this.productoSeleccionado = producto;
    this.ajuste = {
      tipo: 'ENTRADA',
      cantidad: 0,
      motivo: ''
    };
    this.displayModal = true;
  }

  async guardarAjuste() {
    if (this.ajuste.cantidad <= 0) {
      alert('La cantidad debe ser mayor a cero.');
      return;
    }

    this.isSaving = true;
    try {
      await this.inventarioService.registrarMovimientoManual(
        this.productoSeleccionado.id,
        this.ajuste.tipo,
        this.ajuste.cantidad,
        this.ajuste.motivo || 'Ajuste manual de inventario'
      );
      this.displayModal = false;
      await this.cargarInventario();
    } catch (e: any) {
      alert('Error al guardar: ' + e.message);
    } finally {
      this.isSaving = false;
    }
  }

  abrirEditarMinimo(producto: any) {
    this.productoSeleccionado = producto;
    this.minimoForm = {
      id: producto.id,
      stock_minimo: producto.stock_minimo || 0
    };
    this.displayMinimoModal = true;
  }

  async guardarMinimo() {
    this.isSavingMinimo = true;
    try {
      const { error } = await this.supabase
        .from('productos')
        .update({ stock_minimo: this.minimoForm.stock_minimo })
        .eq('id', this.minimoForm.id);

      if (error) throw error;
      
      this.displayMinimoModal = false;
      await this.cargarInventario();
    } catch (e: any) {
      alert('Error al actualizar el stock mínimo: ' + e.message);
    } finally {
      this.isSavingMinimo = false;
    }
  }

  async abrirHistorial(producto?: any) {
    this.productoHistorialSeleccionado = producto || null;
    this.displayHistorialModal = true;
    this.loadingHistorial = true;
    this.historial = [];

    let query = this.supabase
      .from('movimientos_inventario')
      .select('*, productos(descripcion), usuarios(correo, nombre_completo)')
      .order('fecha_movimiento', { ascending: false });

    if (producto) {
      query = query.eq('producto_id', producto.id);
    }

    const { data, error } = await query.limit(50);

    if (!error) {
      this.historial = data || [];
    } else {
      console.error('Error cargando historial', error);
    }
    
    this.loadingHistorial = false;
  }
}
