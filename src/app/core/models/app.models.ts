/* 
  AUTO-GENERATED MODELS
  Basado en el esquema de Supabase.
*/

export interface AppLogs {
  id: string;
  nivel: string;
  mensaje: string;
  detalles?: string;
  usuario_id: string;
  fecha_dispositivo?: string;
  created_at?: string;
  device_info?: string;
  app_version?: string;
  [key: string]: any; // Allow Supabase relation joins
}

export interface Clientes {
  id: string;
  documento_identidad: string;
  nombre_razon_social: string;
  direccion?: string;
  telefono?: string;
  correo?: string;
  created_at?: string;
  [key: string]: any; // Allow Supabase relation joins
}

export interface ConfiguracionEmpresa {
  id: number;
  razon_social: string;
  ruc: string;
  direccion_fiscal: string;
  logo_url?: string;
  cuentas_bancarias_json?: any;
  terminos_condiciones_pie?: string;
  updated_at?: string;
  telefonos?: string;
  correo?: string;
  color_hex?: string;
  [key: string]: any; // Allow Supabase relation joins
}

export interface DespachosViajesCabecera {
  id: string;
  pedido_id: string;
  despachador_id: string;
  placa_vehiculo?: string;
  latitud?: number;
  longitud?: number;
  fotos_urls?: any;
  fecha_dispositivo?: string;
  created_at?: string;
  numero_viaje_secuencial?: number;
  chofer_id: string;
  estado_viaje?: string;
  fotos_urls_recepcion_chofer?: any;
  fecha_recepcion_chofer?: string;
  [key: string]: any; // Allow Supabase relation joins
}

export interface DespachosViajesDetalle {
  id: string;
  viaje_id: string;
  pedido_item_id: string;
  cantidad_viaje?: number;
  [key: string]: any; // Allow Supabase relation joins
}

export interface IaChatHistorial {
  id: string;
  usuario_id: string;
  role: string;
  content: string;
  created_at?: string;
  [key: string]: any; // Allow Supabase relation joins
}

export interface MovimientosInventario {
  id: string;
  producto_id: string;
  tipo_movimiento: string;
  cantidad: number;
  motivo: string;
  usuario_id: string;
  fecha_movimiento?: string;
  [key: string]: any; // Allow Supabase relation joins
}

export interface Pagos {
  id: string;
  pedido_id: string;
  monto_pagado: number;
  metodo_pago: string;
  referencia_operacion?: string;
  fecha_pago?: string;
  usuario_id: string;
  [key: string]: any; // Allow Supabase relation joins
}

export interface Pedidos {
  id: string;
  folio: string;
  tipo_documento: string;
  estado: string;
  motivo_anulacion?: string;
  estado_pago: string;
  cliente_id: string;
  vendedor_id: string;
  lugar_entrega: string;
  direccion_entrega_detalle?: string;
  dias_validez_oferta?: number;
  subtotal?: number;
  descuento_global?: number;
  igv?: number;
  total?: number;
  observaciones?: string;
  created_at?: string;
  dias_credito?: number;
  fecha_vencimiento?: string;
  monto_pagado?: number;
  chofer_id: string;
  tracking_token?: string;
  tipo_entrega?: string;
  [key: string]: any; // Allow Supabase relation joins
}

export interface PedidosItems {
  id: string;
  pedido_id: string;
  producto_id: string;
  descripcion_manual?: string;
  unidad_medida_manual?: string;
  cantidad: number;
  precio_unitario?: number;
  subtotal?: number;
  cantidad_despachada?: number;
  [key: string]: any; // Allow Supabase relation joins
}

export interface Productos {
  id: string;
  codigo_sku: string;
  descripcion: string;
  unidad_medida: string;
  precio_unitario_base?: number;
  tipo_inventario: string;
  stock_actual?: number;
  stock_minimo?: number;
  created_at?: string;
  [key: string]: any; // Allow Supabase relation joins
}

export interface RutasGps {
  id: string;
  pedido_id: string;
  chofer_id: string;
  latitud: number;
  longitud: number;
  timestamp: string;
  created_at?: string;
  numero_viaje_secuencial?: number;
  sesion_id: string;
  [key: string]: any; // Allow Supabase relation joins
}

export interface SesionesGps {
  id: string;
  pedido_id: string;
  chofer_id: string;
  timestamp_inicio: string;
  timestamp_fin?: string;
  viaje_id: string;
  estado?: string;
  created_at?: string;
  [key: string]: any; // Allow Supabase relation joins
}

export interface Usuarios {
  id: string;
  correo: string;
  rol: string;
  activo?: boolean;
  created_at?: string;
  nombre_completo?: string;
  [key: string]: any; // Allow Supabase relation joins
}

export interface Vehiculos {
  placa: string;
  created_at?: string;
  [key: string]: any; // Allow Supabase relation joins
}

export interface ViajesEntregas {
  id: string;
  pedido_id: string;
  numero_viaje_secuencial: number;
  chofer_id: string;
  latitud?: number;
  longitud?: number;
  fecha_dispositivo?: string;
  created_at?: string;
  updated_at?: string;
  fotos_urls_entrega?: any;
  [key: string]: any; // Allow Supabase relation joins
}

