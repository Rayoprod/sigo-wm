import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { Productos, MovimientosInventario, PedidosItems } from '../models/app.models';

@Injectable({ providedIn: 'root' })
export class InventarioService {
  supabase = inject(SupabaseService).client;
  auth = inject(AuthService);

  /* Registra un movimiento manual (ajuste) y actualiza el stock actual del producto.
   */
  async registrarMovimientoManual(productoId: string, tipo: string, cantidad: number, motivo: string) {
    if (!productoId || cantidad <= 0) throw new Error("Datos inválidos para el movimiento.");

    // Validar sesión antes de cualquier escritura para no grabar usuario_id nulo
    const usuario = this.auth.currentUser();
    if (!usuario) {
      throw new Error('No se pudo identificar al usuario actual. Inicia sesión nuevamente.');
    }

    // Ajuste atómico vía RPC: el UPDATE de stock y el INSERT del movimiento
    // ocurren en una sola transacción con bloqueo de fila. Se preserva el
    // comportamiento actual: los ajustes manuales pueden dejar stock negativo.
    const { error } = await this.supabase.rpc('ajustar_stock_atomico', {
      p_producto_id: productoId,
      p_tipo_movimiento: tipo,
      p_cantidad: cantidad,
      p_motivo: motivo,
      p_usuario_id: usuario.id,
      p_validar_negativo: false
    });

    if (error) throw error;
  }

  /*Descuenta automáticamente el inventario al aprobar una Orden de Venta
   */
  async descontarStockPorVenta(pedidoId: string, folioPedido: string) {
    // 1. Obtener los ítems de la venta que están ligados a un producto real del catálogo
    const { data: items, error: errItems } = await this.supabase
      .from('pedidos_items')
      .select('producto_id, cantidad, descripcion_manual')
      .eq('pedido_id', pedidoId)
      .not('producto_id', 'is', null);

    if (errItems) throw errItems;
    if (!items || items.length === 0) return; // Nada que descontar si eran manuales sin ID

    // Validar sesión antes de cualquier escritura para no grabar usuario_id nulo
    const usuario = this.auth.currentUser();
    if (!usuario) {
      throw new Error('No se pudo identificar al usuario actual. Inicia sesión nuevamente.');
    }

    // Procesar cada ítem con la función RPC atómica.
    // Antes se hacía SELECT → INSERT → UPDATE desde el cliente: entre el
    // SELECT y el UPDATE, otra venta aprobada al mismo tiempo sobre el mismo
    // producto leía el mismo stock y ambas sobrescribían stock_actual. Ahora
    // el descuento y el registro del movimiento se ejecutan en una sola
    // transacción con bloqueo de fila, y la validación de stock negativo es real.
    for (const item of items) {
      const { error } = await this.supabase.rpc('ajustar_stock_atomico', {
        p_producto_id: item.producto_id,
        p_tipo_movimiento: 'VENTA_AUTOMATICA',
        p_cantidad: Number(item.cantidad),
        p_motivo: `Venta Aprobada: ${folioPedido}`,
        p_usuario_id: usuario.id,
        p_validar_negativo: true
      });

      if (error) throw error;
    }
  }

  /** Repone automáticamente el inventario al anular o editar una Orden de Venta */
  async reponerStockPorVenta(pedidoId: string, folioPedido: string, prefijoMotivo: string = 'Anulación') {
    const { data: items, error: errItems } = await this.supabase
      .from('pedidos_items')
      .select('producto_id, cantidad')
      .eq('pedido_id', pedidoId)
      .not('producto_id', 'is', null);

    if (errItems) throw errItems;
    if (!items || items.length === 0) return;

    // Validar sesión antes de cualquier escritura para no grabar usuario_id nulo
    const usuario = this.auth.currentUser();
    if (!usuario) {
      throw new Error('No se pudo identificar al usuario actual. Inicia sesión nuevamente.');
    }

    // Reponer con la función RPC atómica (mismo criterio que el descuento):
    // UPDATE de stock + INSERT del movimiento en una sola transacción.
    for (const item of items) {
      const { error } = await this.supabase.rpc('ajustar_stock_atomico', {
        p_producto_id: item.producto_id,
        p_tipo_movimiento: 'ENTRADA',
        p_cantidad: Number(item.cantidad),
        p_motivo: `${prefijoMotivo} de Venta: ${folioPedido}`,
        p_usuario_id: usuario.id,
        p_validar_negativo: false
      });

      if (error) throw error;
    }
  }
}
