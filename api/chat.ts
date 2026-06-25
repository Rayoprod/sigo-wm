import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env['SUPABASE_URL'] || 'https://tgmtncszewvfxspcxgrf.supabase.co';
const supabaseAnonKey = process.env['SUPABASE_ANON_KEY'] || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRnbXRuY3N6ZXd2ZnhzcGN4Z3JmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MDAwMjksImV4cCI6MjA5NzQ3NjAyOX0.sO7PBGT8HpvfrCiwuKPw3lFcq6EXq9VuVQ4B-4cjbxg';

export default async function handler(req: any, res: any) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
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

  const { prompt, history } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const apiKey = process.env['DEEPSEEK_API_KEY'];
  if (!apiKey) {
    return res.status(500).json({ error: 'Falta configurar la DEEPSEEK_API_KEY en Vercel.' });
  }

  // Extraer Token JWT de Supabase desde los headers
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'No autorizado. Falta el token JWT de Supabase.' });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  try {
    // Inicializar OpenAI apuntando a los servidores de DeepSeek
    const openai = new OpenAI({
      apiKey: apiKey,
      baseURL: 'https://api.deepseek.com/v1',
    });
    
    // Declarar Herramientas (Function Calling) en formato OpenAI
    const tools: any = [
      {
        type: "function",
        function: {
          name: "consultar_ventas",
          description: "Obtiene una lista de ventas o pedidos realizados por la empresa. Usa esto si preguntan por ventas, transacciones o dinero ingresado.",
          parameters: { 
            type: "object", 
            properties: { 
              limite: { type: "number", description: "Número máximo de ventas a traer. Default 30" } 
            } 
          }
        }
      },
      {
        type: "function",
        function: {
          name: "consultar_inventario",
          description: "Obtiene el stock actual de los productos de la empresa.",
          parameters: { type: "object", properties: {} }
        }
      },
      {
        type: "function",
        function: {
          name: "consultar_cuentas_por_cobrar",
          description: "Obtiene las deudas pendientes de los clientes.",
          parameters: { type: "object", properties: {} }
        }
      },
      {
        type: "function",
        function: {
          name: "consultar_clientes",
          description: "Obtiene el directorio de clientes registrados.",
          parameters: { type: "object", properties: {} }
        }
      },
      {
        type: "function",
        function: {
          name: "consultar_empresa",
          description: "Obtiene los datos de la empresa como RUC, nombre, dirección y moneda.",
          parameters: { type: "object", properties: {} }
        }
      },
      {
        type: "function",
        function: {
          name: "bi_flujo_caja",
          description: "Calcula los ingresos históricos reales agrupados por mes para ver estacionalidad y liquidez.",
          parameters: { type: "object", properties: {} }
        }
      },
      {
        type: "function",
        function: {
          name: "bi_morosidad",
          description: "Clasifica y agrupa la deuda de los clientes según su antigüedad (0-30 días, 30-60 días, más de 60 días).",
          parameters: { type: "object", properties: {} }
        }
      },
      {
        type: "function",
        function: {
          name: "bi_pareto_clientes",
          description: "Muestra la concentración de ventas buscando a los clientes estrella (top clientes históricos).",
          parameters: { type: "object", properties: {} }
        }
      },
      {
        type: "function",
        function: {
          name: "bi_rotacion_inventario",
          description: "Calcula qué productos se han vendido más históricamente para ver rotación.",
          parameters: { type: "object", properties: {} }
        }
      },
      {
        type: "function",
        function: {
          name: "bi_quiebre_stock",
          description: "Verifica qué productos están por debajo o cerca del stock mínimo (riesgo de desabastecimiento).",
          parameters: { type: "object", properties: {} }
        }
      },
      {
        type: "function",
        function: {
          name: "buscar_historial_cliente",
          description: "Busca a un cliente específico por su nombre o apellido y devuelve sus últimos pedidos con el detalle exacto de qué productos compró.",
          parameters: { 
            type: "object", 
            properties: { nombre_cliente: { type: "string", description: "Nombre, apellido o RUC del cliente a buscar" } },
            required: ["nombre_cliente"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "consultar_estado_pedido",
          description: "Busca un pedido por su número de folio (ej. ORD-000001) y devuelve si ya fue pagado y si sus productos ya fueron despachados. Incluye el detalle exacto de cada pago individual.",
          parameters: { 
            type: "object", 
            properties: { folio_pedido: { type: "string", description: "Folio del pedido, ej. ORD-000001" } },
            required: ["folio_pedido"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "consultar_ultimos_pagos",
          description: "Muestra el historial cronológico exacto de los pagos individuales recientes recibidos en la empresa, independientemente del pedido. Útil para responder 'cuál fue el último pago' o auditar transacciones recientes.",
          parameters: { 
            type: "object", 
            properties: { 
              limite: { type: "number", description: "Cantidad de pagos a recuperar (por defecto 10)" } 
            } 
          }
        }
      },
      {
        type: "function",
        function: {
          name: "consultar_viajes_activos",
          description: "Obtiene la lista de los despachos en tránsito actualmente (estado PENDIENTE o APROBADA) asignados a choferes.",
          parameters: { type: "object", properties: {} }
        }
      },
      {
        type: "function",
        function: {
          name: "analizar_rutas_activas",
          description: "Cruza todos los viajes en tránsito con su última coordenada GPS y la hora en que salieron del almacén para detectar posibles retrasos o tiempos inusualmente largos en ruta.",
          parameters: { type: "object", properties: {} }
        }
      },
      {
        type: "function",
        function: {
          name: "rastrear_chofer",
          description: "Obtiene la última coordenada GPS conocida de un chofer y los eventos recientes de su viaje.",
          parameters: { 
            type: "object", 
            properties: { nombre_chofer: { type: "string", description: "Nombre del chofer a rastrear" } },
            required: ["nombre_chofer"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "trazabilidad_completa_pedido",
          description: "Obtiene toda la historia logística de un pedido: qué productos se pidieron, qué despachador cargó el camión, qué chofer hizo la entrega, eventos en ruta y cantidades exactas enviadas.",
          parameters: { 
            type: "object", 
            properties: { folio_pedido: { type: "string", description: "Folio del pedido a analizar, ej. ORD-000001" } },
            required: ["folio_pedido"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "buscar_entidad_global",
          description: "Busca cualquier término (nombre de empresa, cliente, chofer, despachador) para saber si existe en el sistema y qué pedidos/viajes tiene asociados.",
          parameters: { 
            type: "object", 
            properties: { termino: { type: "string", description: "Término a buscar, ej. 'Palkia', 'Juan', 'Aceros'" } },
            required: ["termino"]
          }
        }
      }
    ];

    const systemInstruction = `
Eres "Monito", el Asistente Experto en Business Intelligence (BI) y Coordinador Logístico de SIGO (Sistema Integrado de Gestión Operativa), una empresa peruana de distribución de materiales de construcción.
Tu personalidad es la de un copiloto logístico y financiero brillante, altamente proactivo, amigable y sumamente analítico. Tienes conciencia total sobre las ventas, inventarios, despachos y choferes en ruta.

ROLES DEL SISTEMA:
- Admin/Vendedor: Crea pedidos, aprueba órdenes, ve el chat y despachos.
- Despachador: En planta, carga los materiales al vehículo y registra fotográficamente el envío.
- Chofer: Conduce el vehículo y registra la entrega en el destino con foto de la guía.

FLUJO OPERATIVO:
1. Se crea un Pedido (estado: BORRADOR) → El vendedor lo aprueba (APROBADA).
2. El Despachador ve el pedido, selecciona qué materiales carga en el viaje, toma foto, registra despacho.
3. El Chofer recibe la carga, maneja al destino, toma foto de la guía sellada y registra la entrega.
4. Los pagos se registran en la tabla 'pagos' y se pueden hacer parcialmente.

REGLAS ESTRICTAS DE RESPUESTA:
1. TONO: Amigable pero profesional. Si te preguntan por términos ambiguos (ej. "Palkia"), usa "buscar_entidad_global" antes de asumir que no existe.
2. VOCABULARIO: Usa "unidad de transporte", "vehículo" o "movilidad" en lugar de "camión". El "despachador" carga en almacén; el "chofer" conduce y entrega.
3. CONCISIÓN: Ve al grano con viñetas o listas. Evita párrafos largos.
4. FORMATO: Responde EXCLUSIVAMENTE en HTML. PROHIBIDO usar Markdown (sin ##, sin **, sin #). Usa <b> para negritas, <br><br> para párrafos, <ul><li> para listas.
5. TABLAS PROHIBIDAS: NUNCA uses <table>, <tr>, <th>, <td>. Rompen la interfaz móvil. Para conjuntos de datos usa SIEMPRE listas <ul><li> con emojis.
6. PRECISIÓN: Eres ultra inteligente. Si te piden el estado de despachos, revisa todos los datos. Usa "trazabilidad_completa_pedido" para desglosar un pedido.
7. MONEDA: Soles Peruanos. Usa "S/" (ejemplo: S/ 4,380.00). JAMÁS uses "$".
8. ZONA HORARIA: Resta 5 horas a los datos UTC para mostrar hora local de Perú (UTC-5).
9. DATOS EN TIEMPO REAL: Siempre consulta las herramientas disponibles para dar datos actualizados. No inventes números.
10. PAGOS PARCIALES: Los pedidos pueden tener múltiples pagos parciales. La deuda real = total del pedido - suma de todos los pagos en la tabla 'pagos'.
    `;

    // OBTENER EL USUARIO AUTENTICADO
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return res.status(401).json({ error: 'Usuario no autenticado. Inicia sesión nuevamente.' });
    }

    // OBTENER DETALLES DEL USUARIO
    const { data: userData } = await supabase.from('usuarios').select('nombre_completo, rol').eq('id', user.id).single();
    const userName = userData?.nombre_completo || 'Usuario';
    const userRole = userData?.rol || 'Invitado';

    const systemInstructionFinal = systemInstruction + `\n9. CONTEXTO ACTUAL: Estás conversando con ${userName}, cuyo rol es ${userRole}. Dirígete a esta persona por su nombre.`;

    // LIMPIAR HISTORIAL ANTIGUO (>24 horas)
    const veinticuatroHorasAtras = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('ia_chat_historial').delete()
      .eq('usuario_id', user.id)
      .lt('created_at', veinticuatroHorasAtras);

    // OBTENER EL HISTORIAL RECIENTE (Últimos 5 mensajes)
    const { data: dbHistory } = await supabase.from('ia_chat_historial')
      .select('role, content')
      .eq('usuario_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5);
      
    const parsedHistory = (dbHistory || []).reverse().map((msg: any) => ({
      role: msg.role,
      content: msg.content
    }));

    let messages: any[] = [
      { role: "system", content: systemInstructionFinal },
      ...parsedHistory,
      { role: "user", content: prompt }
    ];

    // GUARDAR EL PROMPT ACTUAL EN LA BD
    await supabase.from('ia_chat_historial').insert({
      usuario_id: user.id,
      role: 'user',
      content: prompt
    });

    let iteraciones = 0;
    while (iteraciones < 5) {
      let response;
      try {
        response = await openai.chat.completions.create({
          model: "deepseek-chat",
          messages: messages,
          tools: tools,
          temperature: 0.1
        });
      } catch (err) {
        console.error("Error llamando a la IA:", err);
        return res.status(500).json({ response: "<b>Error de conexión:</b> En este momento el cerebro de Monito está procesando demasiada información o hubo una falla en el proveedor. Por favor, intenta de nuevo en unos segundos." });
      }

      const responseMessage = response.choices[0].message;
      messages.push(responseMessage);

      // Si no hay más llamadas a herramientas, hemos terminado
      if (!responseMessage.tool_calls || responseMessage.tool_calls.length === 0) {
        // GUARDAR RESPUESTA DE LA IA EN LA BD
        await supabase.from('ia_chat_historial').insert({
          usuario_id: user.id,
          role: 'assistant',
          content: responseMessage.content
        });
        return res.status(200).json({ response: responseMessage.content });
      }

      // Procesar cada llamada a herramienta en PARALELO para extrema velocidad
      const toolResults = await Promise.all(responseMessage.tool_calls.map(async (toolCall: any) => {
        let apiResponse: any = {};
        const functionName = toolCall.function.name;
        const args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};

        try {
          if (functionName === 'consultar_ventas') {
            const limit = args.limite || 30;
            const { data } = await supabase.from('pedidos').select('folio, total, estado, clientes(nombre_razon_social), created_at').order('created_at', { ascending: false }).limit(limit);
            apiResponse = data || [];
          } else if (functionName === 'buscar_historial_cliente') {
            const nombre = args.nombre_cliente;
            const { data } = await supabase.from('pedidos')
              .select('folio, total, estado, created_at, clientes!inner(nombre_razon_social), pedidos_items(productos(descripcion), descripcion_manual, cantidad, precio_unitario, cantidad_despachada)')
              .ilike('clientes.nombre_razon_social', `%${nombre}%`)
              .order('created_at', { ascending: false }).limit(10);
            apiResponse = data || [];
          } else if (functionName === 'consultar_ultimos_pagos') {
            const limit = args.limite || 10;
            const { data } = await supabase.from('pagos')
              .select('id, monto_pagado, fecha_pago, metodo_pago, referencia_operacion, pedidos(folio, clientes(nombre_razon_social))')
              .order('fecha_pago', { ascending: false })
              .limit(limit);
            apiResponse = data || [];
          } else if (functionName === 'consultar_estado_pedido') {
            const folio = args.folio_pedido;
            const { data } = await supabase.from('pedidos')
              .select('folio, estado, total, pagos(monto_pagado, fecha_pago, metodo_pago, referencia_operacion), pedidos_items(productos(descripcion), descripcion_manual, cantidad, cantidad_despachada)')
              .eq('folio', folio)
              .single();
            apiResponse = data || { error: "Pedido no encontrado" };
          } else if (functionName === 'consultar_inventario') {
            const { data } = await supabase.from('productos').select('descripcion, stock_actual, stock_minimo, precio_unitario_base');
            apiResponse = data || [];
          } else if (functionName === 'consultar_cuentas_por_cobrar') {
            const { data: deudasRaw } = await supabase.from('pedidos').select('folio, total, estado, clientes(nombre_razon_social), pagos(monto_pagado)').neq('estado', 'ANULADA').order('created_at', { ascending: false }).limit(2000);
            apiResponse = deudasRaw?.map((d: any) => {
              const pagado = d.pagos?.reduce((sum: number, p: any) => sum + Number(p.monto_pagado), 0) || 0;
              return { cliente: d.clientes?.nombre_razon_social || 'Desconocido', deuda: Number(d.total) - pagado, folio: d.folio };
            }).filter(d => d.deuda > 0) || [];
          } else if (functionName === 'consultar_clientes') {
            const { data } = await supabase.from('clientes').select('nombre_razon_social, documento_identidad, correo, telefono');
            apiResponse = data || [];
          } else if (functionName === 'consultar_empresa') {
            const { data } = await supabase.from('configuracion_empresa').select('*').limit(1);
            apiResponse = data || [];
          } else if (functionName === 'bi_flujo_caja') {
            const { data: pagos } = await supabase.from('pagos').select('monto_pagado, created_at').order('created_at', { ascending: false }).limit(2000);
            const flujoPorMes: any = {};
            pagos?.forEach((p: any) => {
              const mes = p.created_at.substring(0, 7);
              flujoPorMes[mes] = (flujoPorMes[mes] || 0) + Number(p.monto_pagado);
            });
            apiResponse = Object.keys(flujoPorMes).map(k => ({ mes: k, ingresos: flujoPorMes[k] })).sort((a,b) => b.mes.localeCompare(a.mes));
          } else if (functionName === 'bi_morosidad') {
            const { data: deudasRaw } = await supabase.from('pedidos').select('folio, total, estado, clientes(nombre_razon_social), pagos(monto_pagado), created_at').neq('estado', 'ANULADA').order('created_at', { ascending: false }).limit(2000);
            const morosidad = { '0_a_30_dias': 0, '31_a_60_dias': 0, 'mas_de_60_dias': 0, 'deuda_total': 0, detalle_critico: [] as any[] };
            const hoy = new Date().getTime();
            deudasRaw?.forEach((d: any) => {
              const pagado = d.pagos?.reduce((sum: number, p: any) => sum + Number(p.monto_pagado), 0) || 0;
              const deuda = Number(d.total) - pagado;
              if (deuda > 0) {
                const dias = Math.floor((hoy - new Date(d.created_at).getTime()) / (1000 * 60 * 60 * 24));
                morosidad.deuda_total += deuda;
                if (dias <= 30) morosidad['0_a_30_dias'] += deuda;
                else if (dias <= 60) morosidad['31_a_60_dias'] += deuda;
                else {
                  morosidad['mas_de_60_dias'] += deuda;
                  morosidad.detalle_critico.push({ cliente: d.clientes?.nombre_razon_social || 'Desconocido', deuda, dias_retraso: dias, folio: d.folio });
                }
              }
            });
            apiResponse = morosidad;
          } else if (functionName === 'bi_pareto_clientes') {
            const { data: ventasPareto } = await supabase.from('pedidos').select('total, estado, clientes(nombre_razon_social)').neq('estado', 'ANULADA').order('created_at', { ascending: false }).limit(2000);
            const clientesTotales: any = {};
            ventasPareto?.forEach((v: any) => {
              const nom = v.clientes?.nombre_razon_social || 'Consumidor Final';
              clientesTotales[nom] = (clientesTotales[nom] || 0) + Number(v.total);
            });
            apiResponse = Object.keys(clientesTotales)
              .map(k => ({ cliente: k, compras_totales: clientesTotales[k] }))
              .sort((a,b) => b.compras_totales - a.compras_totales)
              .slice(0, 5);
          } else if (functionName === 'bi_rotacion_inventario') {
            const { data: items } = await supabase.from('pedidos_items').select('cantidad, productos(descripcion), descripcion_manual').limit(2000);
            const rotacion: any = {};
            items?.forEach((item: any) => {
              const desc = item.productos?.descripcion || item.descripcion_manual || 'Desconocido';
              rotacion[desc] = (rotacion[desc] || 0) + Number(item.cantidad);
            });
            apiResponse = Object.keys(rotacion)
              .map(k => ({ producto: k, unidades_vendidas: rotacion[k] }))
              .sort((a,b) => b.unidades_vendidas - a.unidades_vendidas)
              .slice(0, 10);
          } else if (functionName === 'bi_quiebre_stock') {
            const { data: quiebre } = await supabase.from('productos').select('descripcion, stock_actual, stock_minimo');
            apiResponse = quiebre?.filter(q => Number(q.stock_actual) <= Number(q.stock_minimo)) || [];
          } else if (functionName === 'analizar_rutas_activas') {
            const ahora = new Date().getTime();
            const { data: gpsData } = await supabase.from('rutas_gps')
              .select('chofer_id, timestamp, pedido_id, pedidos(folio)')
              .order('timestamp', { ascending: false })
              .limit(100);

            if (!gpsData || gpsData.length === 0) {
              apiResponse = { mensaje: "No hay camiones en ruta actualmente." };
            } else {
               const choferesMap = new Map();
               gpsData.forEach((g: any) => {
                 if (!choferesMap.has(g.chofer_id)) {
                   const uGps = new Date(g.timestamp).getTime();
                   const horasSinConexion = Number(((ahora - uGps) / (1000 * 60 * 60)).toFixed(1));
                   choferesMap.set(g.chofer_id, {
                     pedido: g.pedidos?.folio || 'Desconocido',
                     ultima_conexion_gps: `Hace ${horasSinConexion} horas`,
                     alerta: (horasSinConexion > 1) ? 'GPS INACTIVO / POSIBLE RETRASO' : 'OK'
                   });
                 }
               });
               apiResponse = Array.from(choferesMap.values());
            }
          } else if (functionName === 'consultar_viajes_activos') {
            const { data: viajes } = await supabase.from('pedidos')
              .select('folio, estado, clientes(nombre_razon_social), viajes_entregas(usuarios(nombre_completo))')
              .in('estado', ['PENDIENTE', 'APROBADA'])
              .eq('lugar_entrega', 'OBRA');
            apiResponse = viajes?.map((v: any) => ({
              folio: v.folio,
              estado: v.estado,
              cliente: (v.clientes as any)?.nombre_razon_social,
              chofer: (v.viajes_entregas && v.viajes_entregas.length > 0) ? (v.viajes_entregas[0].usuarios as any)?.nombre_completo : 'No asignado'
            })) || [];
          } else if (functionName === 'rastrear_chofer') {
            const nombreChofer = args.nombre_chofer;
            // 1. Buscar al chofer
            const { data: choferes } = await supabase.from('usuarios').select('id, nombre_completo').ilike('nombre_completo', `%${nombreChofer}%`).eq('rol', 'chofer').limit(1);
            if (!choferes || choferes.length === 0) {
              apiResponse = { error: "Chofer no encontrado" };
            } else {
              const choferId = choferes[0].id;
              // 2. Buscar último GPS
              const { data: gps } = await supabase.from('rutas_gps').select('latitud, longitud, timestamp').eq('chofer_id', choferId).order('timestamp', { ascending: false }).limit(1);
              // 3. Buscar última entrega
              const { data: entrega } = await supabase.from('viajes_entregas').select('numero_viaje_secuencial, created_at, pedidos(folio)').eq('chofer_id', choferId).order('created_at', { ascending: false }).limit(1);
              
              apiResponse = {
                chofer: choferes[0].nombre_completo,
                ultima_ubicacion_gps: gps && gps.length > 0 ? gps[0] : 'Sin datos GPS',
                ultimo_evento_viaje: 'Sin eventos (funcionalidad no disponible)',
                ultima_entrega_completada: entrega && entrega.length > 0 ? { viaje_num: entrega[0].numero_viaje_secuencial, fecha: entrega[0].created_at, pedido: (entrega[0].pedidos as any)?.folio } : 'Sin entregas'
              };
            }
          } else if (functionName === 'trazabilidad_completa_pedido') {
            const folio = args.folio_pedido;
            // Pedido Base
            const { data: pedido } = await supabase.from('pedidos')
              .select('id, folio, estado, total, clientes(nombre_razon_social), pedidos_items(productos(descripcion), descripcion_manual, cantidad, cantidad_despachada)')
              .eq('folio', folio)
              .single();
            if (!pedido) {
              apiResponse = { error: "Pedido no encontrado" };
            } else {
              // Carga del Despachador
              const { data: cargas } = await supabase.from('despachos_viajes_cabecera')
                .select('numero_viaje_secuencial, fecha_dispositivo, usuarios!despachos_viajes_cabecera_despachador_id_fkey(nombre_completo), placa_vehiculo, despachos_viajes_detalle(cantidad_viaje, pedidos_items(productos(descripcion), descripcion_manual))')
                .eq('pedido_id', pedido.id);
              // Entregas del Chofer
              const { data: entregas } = await supabase.from('viajes_entregas')
                .select('numero_viaje_secuencial, created_at, latitud, longitud, usuarios(nombre_completo)')
                .eq('pedido_id', pedido.id);
              
              apiResponse = {
                informacion_general: {
                  folio: pedido.folio,
                  estado: pedido.estado,
                  cliente: (pedido.clientes as any)?.nombre_razon_social,
                  monto: pedido.total
                },
                productos_solicitados: pedido.pedidos_items,
                cargas_de_almacen: cargas || [],
                entregas_de_chofer: entregas || []
              };
            }
          } else if (functionName === 'buscar_entidad_global') {
            const term = args.termino;
            
            // Buscar en Clientes
            const { data: clientes } = await supabase.from('clientes')
              .select('id, nombre_razon_social, pedidos(folio, estado)')
              .ilike('nombre_razon_social', `%${term}%`)
              .limit(5);
              
            // Buscar en Usuarios (Choferes, Despachadores)
            const { data: usuarios } = await supabase.from('usuarios')
              .select('id, nombre_completo, rol')
              .ilike('nombre_completo', `%${term}%`)
              .limit(5);
              
            let resumenUsuarios: any[] = [];
            for (const usr of (usuarios || [])) {
              if (usr.rol === 'chofer') {
                const { data: entregas } = await supabase.from('viajes_entregas').select('numero_viaje_secuencial, pedidos(folio)').eq('chofer_id', usr.id).limit(5);
                resumenUsuarios.push({ ...usr, historial_entregas: entregas });
              } else if (usr.rol === 'despachador') {
                const { data: cargas } = await supabase.from('despachos_viajes_cabecera').select('numero_viaje_secuencial, pedidos(folio)').eq('despachador_id', usr.id).limit(5);
                resumenUsuarios.push({ ...usr, historial_cargas: cargas });
              } else {
                resumenUsuarios.push(usr);
              }
            }
            
            apiResponse = {
              clientes_encontrados: clientes || [],
              usuarios_encontrados: resumenUsuarios
            };
          } else {
            apiResponse = { error: "Función no encontrada" };
          }
        } catch (err: any) {
          apiResponse = { error: err.message };
        }

        return {
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(apiResponse)
        };
      }));

      messages.push(...toolResults);
      
      iteraciones++;
    }

    return res.status(200).json({ response: messages[messages.length - 1].content || "Llegué al límite de procesamiento, por favor se más específico." });

  } catch (error: any) {
    console.error("DeepSeek API Error:", error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor conectando con DeepSeek' });
  }
}
