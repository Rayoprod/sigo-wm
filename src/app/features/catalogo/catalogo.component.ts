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
import { TabViewModule } from 'primeng/tabview';

@Component({
  selector: 'app-catalogo',
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
    CardModule,
    TabViewModule
  ],
  templateUrl: './catalogo.component.html',
  styleUrl: './catalogo.component.scss'
})
export class CatalogoComponent implements OnInit {
  supabase = inject(SupabaseService).client;
  inventarioService = inject(InventarioService);

  productos: any[] = [];
  loading = false;

  // ── CATÁLOGO ──────────────────────────────────────────────────
  displayModalProducto = false;
  isSavingProducto = false;

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

  productoForm: any = {
    id: null,
    codigo_sku: '',
    descripcion: '',
    unidad_medida: 'UND',
    precio_unitario_base: null,
    tipo_inventario: 'GRANEL_ESTIMADO',
    stock_actual: null,
    stock_minimo: 0
  };

  // ── STOCK / INVENTARIO ────────────────────────────────────────
  displayModalAjuste = false;
  isSavingAjuste = false;
  displayModalMinimo = false;
  isSavingMinimo = false;
  displayModalHistorial = false;
  loadingHistorial = false;

  productoSeleccionado: any = null;
  historial: any[] = [];
  minimoForm = { id: '', stock_minimo: 0 };

  ajuste = { tipo: 'ENTRADA', cantidad: 0, motivo: '' };
  tiposMovimiento = [
    { label: 'Entrada (Suma)', value: 'ENTRADA' },
    { label: 'Salida / Merma (Resta)', value: 'SALIDA_MANUAL' }
  ];

  // ─────────────────────────────────────────────────────────────

  async ngOnInit() {
    await this.cargarProductos();
  }

  async cargarProductos() {
    this.loading = true;
    const { data, error } = await this.supabase
      .from('productos')
      .select('*')
      .order('descripcion', { ascending: true });
    if (!error) this.productos = data || [];
    this.loading = false;
  }

  // ── CATÁLOGO: acciones ────────────────────────────────────────

  abrirNuevo() {
    this.productoForm = {
      id: null, codigo_sku: '', descripcion: '',
      unidad_medida: 'UND', precio_unitario_base: null,
      tipo_inventario: 'GRANEL_ESTIMADO', stock_actual: null, stock_minimo: 0
    };
    this.displayModalProducto = true;
  }

  abrirEditar(producto: any) {
    this.productoForm = { ...producto };
    this.displayModalProducto = true;
  }

  async eliminarProducto(producto: any) {
    if (!confirm(`¿Eliminar el producto "${producto.descripcion}"?`)) return;
    try {
      const { error } = await this.supabase.from('productos').delete().eq('id', producto.id);
      if (error) throw error;
      await this.cargarProductos();
    } catch {
      alert('No se puede eliminar: el producto ya tiene ventas o movimientos de inventario asociados.');
    }
  }

  async guardarProducto() {
    if (!this.productoForm.descripcion) { alert('La descripción es obligatoria.'); return; }
    this.isSavingProducto = true;
    try {
      if (this.productoForm.id) {
        const { id, created_at, ...updateData } = this.productoForm;
        const { error } = await this.supabase.from('productos').update(updateData).eq('id', id);
        if (error) throw error;
      } else {
        const { id, stock_actual, codigo_sku, ...insertData } = this.productoForm;
        const { data: insertado, error } = await this.supabase
          .from('productos').insert({ ...insertData, stock_actual: 0 }).select('id').single();
        if (error) throw error;
        if (stock_actual && stock_actual > 0) {
          await this.inventarioService.registrarMovimientoManual(insertado.id, 'ENTRADA', stock_actual, 'Inventario Inicial');
        }
      }
      this.displayModalProducto = false;
      await this.cargarProductos();
    } catch (e: any) {
      alert('Error al guardar: ' + e.message);
    } finally {
      this.isSavingProducto = false;
    }
  }

  // ── STOCK: acciones ────────────────────────────────────────────

  abrirAjuste(producto: any) {
    this.productoSeleccionado = producto;
    this.ajuste = { tipo: 'ENTRADA', cantidad: 0, motivo: '' };
    this.displayModalAjuste = true;
  }

  async guardarAjuste() {
    if (this.ajuste.cantidad <= 0) { alert('La cantidad debe ser mayor a cero.'); return; }
    this.isSavingAjuste = true;
    try {
      await this.inventarioService.registrarMovimientoManual(
        this.productoSeleccionado.id, this.ajuste.tipo,
        this.ajuste.cantidad, this.ajuste.motivo || 'Ajuste manual'
      );
      this.displayModalAjuste = false;
      await this.cargarProductos();
    } catch (e: any) {
      alert('Error al guardar: ' + e.message);
    } finally {
      this.isSavingAjuste = false;
    }
  }

  abrirEditarMinimo(producto: any) {
    this.productoSeleccionado = producto;
    this.minimoForm = { id: producto.id, stock_minimo: producto.stock_minimo || 0 };
    this.displayModalMinimo = true;
  }

  async guardarMinimo() {
    this.isSavingMinimo = true;
    try {
      const { error } = await this.supabase.from('productos')
        .update({ stock_minimo: this.minimoForm.stock_minimo }).eq('id', this.minimoForm.id);
      if (error) throw error;
      this.displayModalMinimo = false;
      await this.cargarProductos();
    } catch (e: any) {
      alert('Error: ' + e.message);
    } finally {
      this.isSavingMinimo = false;
    }
  }

  async abrirHistorial(producto?: any) {
    this.productoSeleccionado = producto || null;
    this.displayModalHistorial = true;
    this.loadingHistorial = true;
    this.historial = [];

    let query = this.supabase.from('movimientos_inventario')
      .select('*, productos(descripcion), usuarios(correo, nombre_completo)')
      .order('fecha_movimiento', { ascending: false });

    if (producto) query = query.eq('producto_id', producto.id);

    const { data, error } = await query.limit(50);
    if (!error) this.historial = data || [];
    this.loadingHistorial = false;
  }
}
