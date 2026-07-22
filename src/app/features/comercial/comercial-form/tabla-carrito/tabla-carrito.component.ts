import { Component, EventEmitter, Input, Output, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { DropdownModule } from 'primeng/dropdown';
import { InputNumberModule } from 'primeng/inputnumber';
import { ButtonModule } from 'primeng/button';
import { SupabaseService } from '../../../../core/services/supabase.service';
import { AuthService } from '../../../../core/services/auth.service';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';

export interface CarritoItem {
  id_temporal?: string; // uuid
  producto_id?: string;
  producto_obj?: any; // Para p-autoComplete
  descripcion: string;
  unidad_medida: string;
  cantidad: number | null;
  precio_unitario: number | null;
  subtotal: number;
  is_custom: boolean;
  precio_base?: number;
  stock_actual?: number;
  stock_minimo?: number;
}

@Component({
  selector: 'app-tabla-carrito',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    AutoCompleteModule,
    DropdownModule,
    InputNumberModule,
    InputNumberModule,
    ButtonModule,
    DialogModule,
    InputTextModule
  ],
  templateUrl: './tabla-carrito.component.html',
  styleUrl: './tabla-carrito.component.scss'
})
export class TablaCarritoComponent implements OnInit {
  @Input() items: CarritoItem[] = [];
  @Output() itemsChange = new EventEmitter<CarritoItem[]>();

  unidadesMedida = [
    { label: 'UND (Unidad)', value: 'UND' },
    { label: 'M3 (Metros Cúbicos)', value: 'M3' },
    { label: 'SACO_20KG (Saco 20kg)', value: 'SACO_20KG' },
    { label: 'SACO_42.5KG (Saco 42.5kg)', value: 'SACO_42.5KG' },
    { label: 'KG (Kilogramos)', value: 'KG' },
    { label: 'GLN (Galones)', value: 'GLN' },
    { label: 'VIAJE (Fletes/Viajes)', value: 'VIAJE' },
    { label: 'SERVICIO (General)', value: 'SERVICIO' }
  ];

  filteredProductos: any[] = [];
  
  // Variables para Creación Rápida
  displayNuevoProducto = false;
  isSavingProducto = false;
  productoRapido: any = {
    descripcion: '',
    unidad_medida: 'UND',
    precio_unitario_base: null,
    stock_actual: null,
    stock_minimo: 0
  };
  itemPendienteSeleccion: CarritoItem | null = null;
  
  constructor(private supabase: SupabaseService, private auth: AuthService) {}

  ngOnInit() {
    if (this.items.length === 0) {
      this.agregarFila();
    }
  }

  agregarFila() {
    this.items.push({
      id_temporal: crypto.randomUUID(),
      descripcion: '',
      unidad_medida: 'Unidad',
      is_custom: true,
      cantidad: null as any,
      precio_unitario: null as any,
      subtotal: 0
    });
    this.emitChange();
  }

  eliminarFila(index: number) {
    this.items.splice(index, 1);
    if (this.items.length === 0) {
      this.agregarFila();
    } else {
      this.emitChange();
    }
  }

  recalcularSubtotal(item: CarritoItem) {
    if (item.cantidad != null && item.precio_unitario != null) {
      item.subtotal = Number((item.cantidad * item.precio_unitario).toFixed(2));
    } else {
      item.subtotal = 0;
    }
    this.emitChange();
  }

  async buscarProductos(event: any) {
    const query = event.query;
    const { data } = await this.supabase.client
      .from('productos')
      .select('id, codigo_sku, descripcion, unidad_medida, precio_unitario_base, stock_actual, stock_minimo')
      .ilike('descripcion', `%${query}%`)
      .limit(10);
      
    this.filteredProductos = data || [];
  }

  onProductoSelect(event: any, item: CarritoItem) {
    const producto = event.value || event;
    if (producto && producto.id) {
      // It's a catalog product
      item.producto_obj = producto;
      item.producto_id = producto.id;
      item.descripcion = producto.descripcion;
      item.unidad_medida = producto.unidad_medida;
      item.precio_unitario = Number(producto.precio_unitario_base) || null;
      item.is_custom = false;
      
      // Para validaciones visuales
      item.precio_base = Number(producto.precio_unitario_base) || 0;
      item.stock_actual = Number(producto.stock_actual) || 0;
      item.stock_minimo = Number(producto.stock_minimo) || 0;
      
      this.recalcularSubtotal(item);
    }
  }

  // To support custom strings typed into the autocomplete
  onProductoBlur(item: CarritoItem, event: any) {
    // Ya no permitimos texto libre, si forceSelection borra el campo, reseteamos el item
    if (!item.producto_obj || typeof item.producto_obj === 'string') {
      item.producto_id = undefined;
      item.producto_obj = null;
      item.descripcion = '';
      item.precio_unitario = null;
      item.unidad_medida = '';
      item.is_custom = false; // Mantenemos false porque ya no hay items libres
    }
  }

  emitChange() {
    this.itemsChange.emit(this.items);
  }

  isStockInsuficiente(item: CarritoItem): boolean {
    if (!item.cantidad || item.stock_actual == null) return false;
    return item.cantidad > item.stock_actual;
  }

  isStockMinimo(item: CarritoItem): boolean {
    if (!item.cantidad || item.stock_actual == null || item.stock_minimo == null) return false;
    if (item.cantidad > item.stock_actual) return false;
    return (item.stock_actual - item.cantidad) <= item.stock_minimo;
  }

  isPrecioBajo(item: CarritoItem): boolean {
    if (item.precio_unitario == null || item.precio_base == null) return false;
    return item.precio_unitario < item.precio_base;
  }

  // --- LÓGICA DE CREACIÓN RÁPIDA DE PRODUCTO ---
  
  abrirNuevoProducto(item: CarritoItem) {
    this.itemPendienteSeleccion = item;
    // Si el usuario intentó escribir algo, usarlo como descripción inicial
    let descInicial = '';
    if (typeof item.descripcion === 'string') {
        descInicial = item.descripcion;
    }
    
    this.productoRapido = {
      descripcion: descInicial,
      unidad_medida: 'UND',
      precio_unitario_base: null,
      stock_actual: null,
      stock_minimo: 0
    };
    this.displayNuevoProducto = true;
  }

  async guardarProductoRapido() {
    if (!this.productoRapido.descripcion || this.productoRapido.precio_unitario_base == null || this.productoRapido.stock_actual == null) {
      alert("Por favor completa los campos requeridos (Nombre, Precio y Stock).");
      return;
    }

    this.isSavingProducto = true;
    try {
      // 1. Insertar en base de datos.
      // El codigo_sku se genera automático en trigger o default.
      const { data: newProd, error } = await this.supabase.client
        .from('productos')
        .insert({
          descripcion: this.productoRapido.descripcion.trim(),
          unidad_medida: this.productoRapido.unidad_medida,
          precio_unitario_base: this.productoRapido.precio_unitario_base,
          stock_actual: this.productoRapido.stock_actual,
          stock_minimo: this.productoRapido.stock_minimo || 0,
          tipo_inventario: 'EMPAQUETADO_EXACTO' // Valor por defecto seguro para nuevos
        })
        .select('*')
        .single();
        
      if (error) throw error;

      // Registrar el stock inicial como movimiento en el historial.
      // Antes, el stock_actual se guardaba directamente en productos sin
      // ningún registro en movimientos_inventario, haciendo el historial
      // imposible de auditar desde el primer día.
      if (newProd && this.productoRapido.stock_actual > 0) {
        await this.supabase.client
          .from('movimientos_inventario')
          .insert({
            producto_id: newProd.id,
            tipo_movimiento: 'ENTRADA',
            cantidad: this.productoRapido.stock_actual,
            motivo: 'Stock Inicial',
            usuario_id: this.auth.currentUser()?.id
          });
      }

      // 2. Autoseleccionarlo en el item de la tabla
      if (this.itemPendienteSeleccion && newProd) {
        this.onProductoSelect({ value: newProd }, this.itemPendienteSeleccion);
      }

      this.displayNuevoProducto = false;
      this.emitChange();
    } catch (e: any) {
      alert('Error al crear producto: ' + e.message);
    } finally {
      this.isSavingProducto = false;
    }
  }
}
