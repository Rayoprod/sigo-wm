import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env['SUPABASE_URL'] || 'https://tgmtncszewvfxspcxgrf.supabase.co';
const supabaseAnonKey = process.env['SUPABASE_ANON_KEY'] || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRnbXRuY3N6ZXd2ZnhzcGN4Z3JmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MDAwMjksImV4cCI6MjA5NzQ3NjAyOX0.sO7PBGT8HpvfrCiwuKPw3lFcq6EXq9VuVQ4B-4cjbxg';

// Token de rastreo:
//   - UUID v4: búsqueda por el enlace seguro generado al crear el pedido.
//   - RUC (11 dígitos), DNI (8 dígitos) o CE (Carné de Extranjería): búsqueda
//     por documento del cliente.
// Los folios son secuenciales y NO son secretos; el endpoint público nunca debe
// aceptarlos como identificador de búsqueda (riesgo de enumeración de pedidos).
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// RUC/DNI puramente numéricos (8-11 dígitos) — también cubre los CE numéricos antiguos (9-10 dígitos).
const RUC_OR_DNI_REGEX = /^\d{8,11}$/;
// Carné de Extranjería con formato actual: 1 letra inicial + 7 a 11 dígitos (ej: A12345678).
const CE_REGEX = /^[A-Za-z]\d{7,11}$/;

// Rate limit simple en memoria (best-effort en serverless).
// El cliente público consulta cada 10s (~6 req/min); 90 req/min por IP es suficiente.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 90;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  // Evitar crecimiento infinito del Map
  if (hits.size > 10_000) {
    for (const [k, v] of hits) {
      if (v.resetAt < now) hits.delete(k);
    }
  }
  const record = hits.get(ip);
  if (!record || record.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  record.count += 1;
  return record.count > RATE_LIMIT_MAX;
}

export default async function handler(req: any, res: any) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Datos de GPS en vivo: nunca cachear (ni CDN ni navegador)
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const token = String(req.query.token || '').trim();
  if (!token) {
    return res.status(400).json({ error: 'Token de rastreo es requerido' });
  }

  // Validar: debe ser un UUID v4 (enlace seguro) o un documento del cliente (RUC/DNI/CE).
  const esUuid = UUID_V4_REGEX.test(token);
  const esRucODni = RUC_OR_DNI_REGEX.test(token) || CE_REGEX.test(token);
  if (!esUuid && !esRucODni) {
    return res.status(400).json({ error: 'Token de rastreo inválido' });
  }

  // Rate limit por IP
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Demasiadas solicitudes. Inténtalo de nuevo en un momento.' });
  }

  // Usar ANON key; las funciones de tracking usan SECURITY DEFINER
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  try {
    // Si el usuario escribió un RUC/DNI/CE, se busca el pedido más reciente del cliente.
    // En caso contrario se usa el tracking_token (UUID) del enlace seguro.
    const rpcResult = esRucODni
      ? await supabase.rpc('get_public_tracking_data_by_ruc', { p_ruc: token })
      : await supabase.rpc('get_public_tracking_data', { p_token: token });

    const { data, error } = rpcResult;

    if (error) {
      console.error('Error RPC:', error);
      return res.status(500).json({ error: 'Error al consultar tracking' });
    }

    if (!data || data.error) {
      return res.status(404).json({ error: data?.error || 'Pedido no encontrado o token inválido' });
    }

    return res.status(200).json(data);
  } catch (err: any) {
    console.error('Error general:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
