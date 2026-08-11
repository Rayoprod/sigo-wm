-- ==========================================================================
-- ajustar_stock_atomico
-- --------------------------------------------------------------------------
-- Función RPC que actualiza el stock de un producto y registra su movimiento
-- de inventario en UNA SOLA transacción.
--
-- Corrige una condición de carrera (CRÍTICA): el flujo anterior ejecutaba
-- desde el cliente 1) SELECT stock_actual → 2) INSERT movimiento → 3) UPDATE
-- stock. Entre el SELECT y el UPDATE, otra venta aprobada al mismo tiempo
-- sobre el mismo producto leía el mismo stock y ambas sobrescribían
-- stock_actual, perdiéndose un descuento (y dejando sin efecto real la
-- validación de stock negativo).
--
-- Esta función serializa los cambios sobre cada producto usando
-- SELECT ... FOR UPDATE, y garantiza que el UPDATE de stock y el INSERT del
-- movimiento se confirmen (o reviertan) juntos.
--
-- Parámetros:
--   p_producto_id      uuid     — productos.id
--   p_tipo_movimiento  text     — 'ENTRADA' | 'SALIDA' | 'VENTA_AUTOMATICA' ...
--   p_cantidad         numeric  — Cantidad (siempre positiva)
--   p_motivo           text     — Motivo legible del movimiento
--   p_usuario_id       uuid     — Usuario que origina el movimiento
--   p_validar_negativo boolean  — true: error si el stock quedaría negativo
--                                 (ventas); false: permite ajustes manuales
--                                 que dejen el stock en negativo
--
-- Retorna: numeric — el nuevo stock_actual del producto.
-- Errores (P0001): 'Datos inválidos para el movimiento de inventario.',
--                  'Producto no encontrado (ID: ...).',
--                  'Stock insuficiente para el producto ...' (si
--                  p_validar_negativo = true).
--
-- Instalar: ejecutar este archivo una sola vez en el SQL Editor de Supabase.
-- ==========================================================================

create or replace function public.ajustar_stock_atomico(
  p_producto_id uuid,
  p_tipo_movimiento text,
  p_cantidad numeric,
  p_motivo text,
  p_usuario_id uuid,
  p_validar_negativo boolean default true
)
returns numeric
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actual numeric;
  v_nuevo_stock numeric;
begin
  if p_producto_id is null or p_cantidad is null or p_cantidad <= 0 then
    raise exception 'Datos inválidos para el movimiento de inventario.';
  end if;

  -- Bloquea la fila del producto para serializar las escrituras concurrentes
  -- sobre el mismo producto (ventas aprobadas simultáneamente, ajustes, etc.).
  select p.stock_actual into v_actual
  from public.productos p
  where p.id = p_producto_id
  for update;

  if not found then
    raise exception 'Producto no encontrado (ID: %)', p_producto_id;
  end if;

  v_actual := coalesce(v_actual, 0);

  if upper(p_tipo_movimiento) = 'ENTRADA' then
    v_nuevo_stock := v_actual + p_cantidad;
  else
    v_nuevo_stock := v_actual - p_cantidad;
    if p_validar_negativo and v_nuevo_stock < 0 then
      raise exception
        'Stock insuficiente para el producto (ID: %). Disponible: %, requerido: %.',
        p_producto_id, v_actual, p_cantidad;
    end if;
  end if;

  update public.productos
  set stock_actual = v_nuevo_stock
  where id = p_producto_id;

  insert into public.movimientos_inventario (
    producto_id,
    tipo_movimiento,
    cantidad,
    motivo,
    usuario_id
  ) values (
    p_producto_id,
    p_tipo_movimiento,
    p_cantidad,
    p_motivo,
    p_usuario_id
  );

  return v_nuevo_stock;
end;
$$;

-- Exponer la función a los roles que usa la aplicación.
-- (Supabase otorga EXECUTE por defecto; el grant lo hace explícito.)
grant execute on function public.ajustar_stock_atomico(uuid, text, numeric, text, uuid, boolean)
  to anon, authenticated, service_role;
