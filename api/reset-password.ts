import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env['SUPABASE_URL'] || 'https://tgmtncszewvfxspcxgrf.supabase.co';

export default async function handler(req: any, res: any) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { userId, newPassword } = req.body || {};

  if (!userId || !newPassword) {
    return res.status(400).json({ error: 'El ID de usuario y la nueva contraseña son requeridos' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  
  if (!serviceRoleKey) {
    console.error("SERVICE ROLE KEY is missing in the environment");
    return res.status(500).json({ error: 'El servidor no tiene credenciales de administrador configuradas.' });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  try {
    const { data, error } = await supabase.auth.admin.updateUserById(
      userId,
      { password: newPassword }
    );

    if (error) {
      console.error("Error from Supabase admin API:", error);
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json({ success: true, message: 'Contraseña actualizada correctamente' });
  } catch (err: any) {
    console.error("Internal server error:", err);
    return res.status(500).json({ error: 'Error interno del servidor al actualizar la contraseña' });
  }
}
