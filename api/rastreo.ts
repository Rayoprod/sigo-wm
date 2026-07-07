import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env['SUPABASE_URL'] || 'https://tgmtncszewvfxspcxgrf.supabase.co';
const supabaseAnonKey = process.env['SUPABASE_ANON_KEY'] || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRnbXRuY3N6ZXd2ZnhzcGN4Z3JmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MDAwMjksImV4cCI6MjA5NzQ3NjAyOX0.sO7PBGT8HpvfrCiwuKPw3lFcq6EXq9VuVQ4B-4cjbxg';

export default async function handler(req: any, res: any) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ error: 'Token de rastreo es requerido' });
  }

  // Validar formato de UUID para mayor seguridad
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(token)) {
    return res.status(400).json({ error: 'Token de rastreo inválido' });
  }

  // Usar ANON key, la función 'get_public_tracking_data' usa SECURITY DEFINER
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  try {
    const { data, error } = await supabase.rpc('get_public_tracking_data', {
      p_token: token
    });

    if (error) {
      console.error("Error RPC:", error);
      return res.status(500).json({ error: 'Error al consultar tracking' });
    }

    if (data && data.error) {
      return res.status(404).json({ error: data.error });
    }

    // Como el RPC original no traía lugar_entrega, hacemos una query rápida para obtenerlo
    if (data && !data.lugar_entrega) {
      const { data: pedidoData, error: pedidoError } = await supabase
        .from('pedidos')
        .select('lugar_entrega')
        .eq('tracking_token', token)
        .single();
        
      if (!pedidoError && pedidoData) {
        data.lugar_entrega = pedidoData.lugar_entrega;
      }
    }

    return res.status(200).json(data);
  } catch (err: any) {
    console.error("Error general:", err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
