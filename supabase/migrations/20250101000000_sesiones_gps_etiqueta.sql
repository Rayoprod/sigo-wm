-- ==========================================================================
-- sesiones_gps_etiqueta
-- --------------------------------------------------------------------------
-- Respaldo con etiqueta (Paso B del flujo offline-first del chofer):
-- al salir de la pantalla de ruta, la app móvil marca la sesión GPS activa
-- como estado 'RESPALDO' y guarda una etiqueta legible
-- ("Respaldo PEDIDO · Viaje #N") + el timestamp del respaldo.
--
-- El despachador ve en la nube qué viaje quedó en pausa y el chofer puede
-- retomar la MISMA sesión al volver a la pantalla (sin duplicar la ruta).
--
-- Los estados de sesiones_gps son: ACTIVO, COMPLETADO, HUERFANA y ahora
-- RESPALDO (sesión en pausa, reanudable).
--
-- Instalar: ejecutar este archivo una sola vez en el SQL Editor de Supabase.
-- ==========================================================================
alter table public.sesiones_gps
  add column if not exists etiqueta text,
  add column if not exists backup_timestamp timestamptz;

-- Índice para consultar rápidamente las sesiones en respaldo de un pedido
create index if not exists sesiones_gps_respaldo_pedido_idx
  on public.sesiones_gps (pedido_id, estado, backup_timestamp desc)
  where estado = 'RESPALDO';
