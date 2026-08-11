import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env['SUPABASE_URL'] || 'https://tgmtncszewvfxspcxgrf.supabase.co';

const supabaseAnonKey = process.env['SUPABASE_ANON_KEY'] || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRnbXRuY3N6ZXd2ZnhzcGN4Z3JmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MDAwMjksImV4cCI6MjA5NzQ3NjAyOX0.sO7PBGT8HpvfrCiwuKPw3lFcq6EXq9VuVQ4B-4cjbxg';

export default async function handler(req: any, res: any) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 1. Verificar autenticación del solicitante mediante JWT
  const authHeader = String(req.headers.authorization || req.headers.Authorization || '');
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return res.status(401).json({ error: 'No autorizado. Se requiere token de sesión.' });
  }

  const anonClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user: callerUser }, error: callerAuthError } = await anonClient.auth.getUser(token);

  if (callerAuthError || !callerUser) {
    return res.status(401).json({ error: 'Sesión de usuario no válida o expirada.' });
  }

  // 2. Verificar rol de Administrador o Superadmin
  const { data: userData } = await anonClient
    .from('usuarios')
    .select('rol, es_superadmin')
    .eq('id', callerUser.id)
    .single();

  const isSuperAdmin = userData?.es_superadmin === true;
  const roles: string[] = Array.isArray(userData?.rol) ? userData.rol : (userData?.rol ? [userData.rol] : []);
  const isAdmin = isSuperAdmin || roles.includes('admin');

  if (!isAdmin) {
    return res.status(403).json({ error: 'Acceso denegado: Se requieren permisos de administrador.' });
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

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  try {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(
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
