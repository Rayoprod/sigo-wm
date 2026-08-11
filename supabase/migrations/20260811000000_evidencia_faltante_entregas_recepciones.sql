-- ==========================================================================
-- evidencia_faltante (entregas + recepciones)
-- --------------------------------------------------------------------------
-- Persiste en la nube la pérdida de evidencia fotográfica para que NO sea
-- silenciosa. Antes, si el archivo de una foto se perdía en el dispositivo
-- (borrado por el SO/limpieza de caché o nunca guardado), la app sincronizaba
-- la fila igualmente y solo registraba el hecho en los logs locales del
-- teléfono: en la nube (y para el despachador/administrador) parecía una
-- entrega o recepción perfectamente normal, solo que sin foto.
--
-- Esta migración agrega:
--   * viajes_entregas.evidencia_faltante (+ _detalle)
--       → la ENTREGA se sincronizó SIN alguna de las fotos esperadas.
--   * despachos_viajes_cabecera.evidencia_recepcion_faltante (+ _detalle)
--       → la RECEPCIÓN del chofer se sincronizó SIN alguna de las fotos esperadas.
--
-- La app móvil escribe estos campos en cada sincronización (ver
-- entregas_local_service.dart y recepciones_local_service.dart):
--   - evidencia_faltante = TRUE  cuando faltó al menos 1 archivo de los esperados
--   - evidencia_faltante_detalle = nombres de los archivos no encontrados
--   - FALSE / NULL cuando la evidencia está completa
--
-- Instalar: ejecutar este archivo UNA sola vez en el SQL Editor de Supabase
-- (o aplicarlo como migración). Es idempotente: puede re-ejecutarse sin
-- efectos secundarios (todas las sentencias usan IF NOT EXISTS).
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 1. viajes_entregas (entregas del chofer)
-- ---------------------------------------------------------------------------
alter table public.viajes_entregas
  add column if not exists evidencia_faltante boolean not null default false,
  add column if not exists evidencia_faltante_detalle text;

comment on column public.viajes_entregas.evidencia_faltante is
  'TRUE si la entrega se sincronizó SIN alguna de las fotos de evidencia esperadas (el/los archivo(s) no existían en el dispositivo).';

comment on column public.viajes_entregas.evidencia_faltante_detalle is
  'Nombres de los archivos de evidencia no encontrados en el dispositivo (separados por coma). NULL si no faltó ninguno.';

-- ---------------------------------------------------------------------------
-- 2. despachos_viajes_cabecera (recepción del chofer)
-- ---------------------------------------------------------------------------
alter table public.despachos_viajes_cabecera
  add column if not exists evidencia_recepcion_faltante boolean not null default false,
  add column if not exists evidencia_recepcion_faltante_detalle text;

comment on column public.despachos_viajes_cabecera.evidencia_recepcion_faltante is
  'TRUE si la recepción del chofer se sincronizó SIN alguna de las fotos esperadas (el/los archivo(s) no existían en el dispositivo).';

comment on column public.despachos_viajes_cabecera.evidencia_recepcion_faltante_detalle is
  'Nombres de los archivos de evidencia no encontrados en el dispositivo (separados por coma). NULL si no faltó ninguno.';

-- ---------------------------------------------------------------------------
-- 3. Backfill histórico — SOLO casos detectables con certeza.
--
--    Entregas: toda fila en viajes_entregas representa una entrega YA
--    registrada; si no tiene NINGUNA foto (NULL, [] o {}) la evidencia se
--    perdió. El cast ::text permite comparar uniformemente si la columna es
--    jsonb, json o text.
--
--    Recepciones: solo aplica a viajes que SÍ tuvieron recepción registrada
--    (fecha_recepcion_chofer no nula). Un viaje aún no recepcionado tiene
--    fotos_urls_recepcion_chofer NULL por NORMALIDAD, no por pérdida, por lo
--    que sin este filtro el backfill marcaría falsos positivos.
--
--    Nota: la pérdida PARCIAL histórica no es detectable retroactivamente
--    porque no se conservó la lista original de archivos esperados.
-- ---------------------------------------------------------------------------
update public.viajes_entregas
set evidencia_faltante = true
where evidencia_faltante = false
  and (
    fotos_urls_entrega is null
    or fotos_urls_entrega::text in ('[]', '{}', 'null')
  );

update public.despachos_viajes_cabecera
set evidencia_recepcion_faltante = true
where evidencia_recepcion_faltante = false
  and fecha_recepcion_chofer is not null
  and (
    fotos_urls_recepcion_chofer is null
    or fotos_urls_recepcion_chofer::text in ('[]', '{}', 'null')
  );

-- ---------------------------------------------------------------------------
-- Verificación (opcional): cuántos registros quedaron marcados.
-- ---------------------------------------------------------------------------
-- select 'viajes_entregas' as tabla, count(*) as con_evidencia_faltante
-- from public.viajes_entregas
-- where evidencia_faltante = true
-- union all
-- select 'despachos_viajes_cabecera', count(*)
-- from public.despachos_viajes_cabecera
-- where evidencia_recepcion_faltante = true;
