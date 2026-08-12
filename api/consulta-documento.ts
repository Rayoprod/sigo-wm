/**
 * Función serverless de Vercel: consulta DNI/RUC en apiperu.dev.
 * El token APIPERU_TOKEN vive SOLO como variable de entorno
 * (dashboard de Vercel y .env.local para `vercel dev`), nunca en el frontend.
 */

// Rate limit simple en memoria (60 req/min por IP)
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
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
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Rate limit por IP
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ success: false, message: 'Demasiadas consultas. Inténtalo de nuevo en un momento.' });
  }

  const documento = String(req.query.documento || '').trim();
  if (!documento) {
    return res.status(400).json({ success: false, message: 'El parámetro "documento" es obligatorio.' });
  }

  // Misma validación de formato que el frontend (src/app/shared/utils/documento-identidad.ts)
  const tipoDoc = getTipoDocumento(documento);
  if (!tipoDoc) {
    return res.status(400).json({
      success: false,
      message: 'El documento debe ser un DNI (8 dígitos), RUC (11 dígitos) o Carné de Extranjería.'
    });
  }
  if (tipoDoc === 'CE') {
    return res.status(400).json({
      success: false,
      message: 'El Carné de Extranjería no se autocompleta con SUNAT/RENIEC. Ingresa los datos del cliente manualmente.'
    });
  }

  const apiKey = process.env['APIPERU_TOKEN'];
  if (!apiKey) {
    console.error('Falta configurar la variable APIPERU_TOKEN en Vercel.');
    return res.status(500).json({ success: false, message: 'Falta configurar la APIPERU_TOKEN en Vercel.' });
  }

  const tipo = tipoDoc === 'DNI' ? 'dni' : 'ruc';
  try {
    const respuesta = await fetch(`https://apiperu.dev/api/${tipo}/${documento}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    });

    let data: any;
    try {
      data = await respuesta.json();
    } catch {
      return res.status(502).json({
        success: false,
        message: `Respuesta inválida del proveedor (HTTP ${respuesta.status})`
      });
    }

    // Reenviar tal cual el estado y el cuerpo de apiperu.dev
    return res.status(respuesta.status).json(data);
  } catch (e: any) {
    console.error('apiperu.dev error:', e?.message || e);
    return res.status(502).json({ success: false, message: 'Error de conexión con el servicio de validación' });
  }
}

/** Clasifica un documento: DNI (8 dígitos), RUC (11 dígitos) o CE (letra + 7-11 dígitos | 9-10 dígitos). */
function getTipoDocumento(documento: string): 'DNI' | 'RUC' | 'CE' | null {
  if (/^\d{8}$/.test(documento)) return 'DNI';
  if (/^\d{11}$/.test(documento)) return 'RUC';
  if (/^[A-Za-z]\d{7,11}$/.test(documento)) return 'CE';
  if (/^\d{9,10}$/.test(documento)) return 'CE';
  return null;
}
