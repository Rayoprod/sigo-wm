import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class InventarioService {
  supabase = inject(SupabaseService).client;
  auth = inject(AuthService);

  /**
   * Registra un movimiento manual (ajuste) y actualiza el stock actual del producto.
   */
  async registrarMovimientoManual(productoId: string, tipo: string, cantidad: number, motivo: string) {
    if (!productoId || cantidad <= 0) throw new Error("Datos inválidos para el movimiento.");

    // 1. Obtener producto actual
    const { data: prod, error: errProd } = await this.supabase
      .from('productos')
      .select('stock_actual')
      .eq('id', productoId)
      .single();

    if (errProd) throw errProd;

    const stockActual = Number(prod.stock_actual) || 0;
    const cantNum = Number(cantidad);
    const nuevoStock = tipo === 'ENTRADA' ? stockActual + cantNum : stockActual - cantNum;

    // 2. Insertar movimiento
    const { error: errMov } = await this.supabase
      .from('movimientos_inventario')
      .insert({
        producto_id: productoId,
        tipo_movimiento: tipo,
        cantidad: cantNum,
        motivo: motivo,
        usuario_id: this.auth.currentUser()?.id
      });

    if (errMov) throw errMov;

    // 3. Actualizar stock en catálogo
    const { error: errUpd } = await this.supabase
      .from('productos')
      .update({ stock_actual: nuevoStock })
      .eq('id', productoId);

    if (errUpd) throw errUpd;
  }

  /**
   * Descuenta automáticamente el inventario al aprobar una Orden de Venta
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

    // Procesar cada ítem
    for (const item of items) {
      const pId = item.producto_id;
      const cantA_descontar = Number(item.cantidad);

      // Obtener stock
      const { data: prod } = await this.supabase
        .from('productos')
        .select('stock_actual')
        .eq('id', pId)
        .single();

      if (prod) {
        const stockActual = Number(prod.stock_actual) || 0;
        const nuevoStock = stockActual - cantA_descontar;

        // Validar que no quede stock negativo antes de descontar.
        // Sin esta validación, dos ventas aprobadas al mismo tiempo sobre
        // el mismo producto podrían dejar stock_actual en negativo.
        if (nuevoStock < 0) {
          throw new Error(
            `Stock insuficiente para el producto (ID: ${pId}). ` +
            `Disponible: ${stockActual}, requerido: ${cantA_descontar}.`
          );
        }

        // Registrar salida
        await this.supabase.from('movimientos_inventario').insert({
          producto_id: pId,
          tipo_movimiento: 'VENTA_AUTOMATICA',
          cantidad: cantA_descontar,
          motivo: `Venta Aprobada: ${folioPedido}`,
          usuario_id: this.auth.currentUser()?.id
        });

        // Descontar
        await this.supabase.from('productos')
          .update({ stock_actual: nuevoStock })
          .eq('id', pId);
      }
    }
  }

  /**
   * Repone automáticamente el inventario al anular o editar una Orden de Venta
   */
  async reponerStockPorVenta(pedidoId: string, folioPedido: string, prefijoMotivo: string = 'Anulación') {
    const { data: items, error: errItems } = await this.supabase
      .from('pedidos_items')
      .select('producto_id, cantidad')
      .eq('pedido_id', pedidoId)
      .not('producto_id', 'is', null);

    if (errItems) throw errItems;
    if (!items || items.length === 0) return;

    for (const item of items) {
      const pId = item.producto_id;
      const cantA_reponer = Number(item.cantidad);

      const { data: prod } = await this.supabase
        .from('productos')
        .select('stock_actual')
        .eq('id', pId)
        .single();

      if (prod) {
        const nuevoStock = (Number(prod.stock_actual) || 0) + cantA_reponer;

        // Registrar entrada por reversión
        await this.supabase.from('movimientos_inventario').insert({
          producto_id: pId,
          tipo_movimiento: 'ENTRADA',
          cantidad: cantA_reponer,
          motivo: `${prefijoMotivo} de Venta: ${folioPedido}`,
          usuario_id: this.auth.currentUser()?.id
        });

        // Reponer stock
        await this.supabase.from('productos')
          .update({ stock_actual: nuevoStock })
          .eq('id', pId);
      }
    }
  }
}
