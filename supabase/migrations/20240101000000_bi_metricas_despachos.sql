-- ==========================================================================
-- bi_metricas_despachos
-- --------------------------------------------------------------------------
-- Métrica única de "tiempo en almacén" (desde que se crea el viaje hasta que
-- el chofer recibe la carga), calculada SOLO sobre viajes ENTREGADOS.
--
-- Devuelve (en formato JSON listo para el API):
--   - viajes_entregados_analizados
--   - promedio_general  { horas, minutos }   (todos los entregados)
--   - promedio_tipico   { horas, minutos }   (sin el caso excepcional)
--   - viaje_excepcional { numero_viaje, horas, minutos } | null
--       (tiempo > 3x la mediana Y >= 1 hora)
--   - viajes_por_estado { ESTADO: cantidad }
--   - detalle_por_chofer [ { chofer, viajes, promedio_horas, promedio_minutos } ]
--
-- La agregación vive en la base de datos para escalar sin límites de filas.
-- Instalar: ejecutar este archivo una sola vez en el SQL Editor de Supabase.
-- Los roles anónimos ya tienen permiso EXECUTE por defecto, no requiere GRANT.
-- ==========================================================================
create or replace function public.bi_metricas_despachos()
returns json
language sql
security definer
stable
as $$
  with base as (
    select d.numero_viaje_secuencial,
           d.estado_viaje,
           u.nombre_completo as chofer,
           extract(epoch from (d.fecha_recepcion_chofer - d.created_at)) / 3600.0 as horas
    from despachos_viajes_cabecera d
    left join usuarios u on u.id = d.chofer_id
    where d.created_at is not null
      and d.fecha_recepcion_chofer is not null
  ),
  entregados as (
    select *
    from base
    where upper(estado_viaje) = 'ENTREGADO'
      and horas >= 0
  ),
  stats as (
    select count(*)::int as n,
           coalesce(avg(horas), 0) as prom_general,
           coalesce(percentile_cont(0.5) within group (order by horas), 0) as mediana
    from entregados
  ),
  umbral as (
    select greatest(stats.mediana * 3, 1) as u
    from stats
  ),
  excepcional as (
    select e.numero_viaje_secuencial, e.horas
    from entregados e, umbral
    where e.horas > umbral.u
    order by e.horas desc
    limit 1
  ),
  tipicos as (
    select e.*
    from entregados e, umbral
    where e.horas <= umbral.u
  ),
  prom_tipico as (
    select coalesce(avg(horas), 0) as t
    from tipicos
  ),
  por_estado as (
    select coalesce(estado_viaje, 'SIN ESTADO') as estado,
           count(*)::int as cantidad
    from base
    group by 1
  ),
  por_chofer as (
    select coalesce(nullif(chofer, ''), 'Sin asignar') as chofer,
           count(*)::int as viajes,
           avg(horas) as prom_horas
    from entregados
    group by 1
  )
  select json_build_object(
    'viajes_entregados_analizados', (select n from stats),
    'promedio_general', json_build_object(
      'horas', round((select prom_general from stats)::numeric, 2),
      'minutos', round((select prom_general from stats)::numeric * 60)
    ),
    'promedio_tipico', json_build_object(
      'horas', round((select t from prom_tipico)::numeric, 2),
      'minutos', round((select t from prom_tipico)::numeric * 60)
    ),
    'viaje_excepcional', case
      when exists (select 1 from excepcional) then
        json_build_object(
          'numero_viaje', (select numero_viaje_secuencial from excepcional),
          'horas', round((select horas from excepcional)::numeric, 2),
          'minutos', round((select horas from excepcional)::numeric * 60)
        )
      else null
    end,
    'viajes_por_estado', coalesce(
      (select json_object_agg(estado, cantidad) from por_estado),
      '{}'::json
    ),
    'detalle_por_chofer', coalesce(
      (select json_agg(
         json_build_object(
           'chofer', chofer,
           'viajes', viajes,
           'promedio_horas', round(prom_horas::numeric, 2),
           'promedio_minutos', round(prom_horas::numeric * 60)
         )
         order by prom_horas desc
       ) from por_chofer),
      '[]'::json
    )
  );
$$;
