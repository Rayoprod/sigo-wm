# 📋 Base de Hechos, Diagnósticos y Resoluciones Logísticas — Sigo-WM & Sigo_WM_Mobile

> **Estado del Documento:** Única Fuente de Verdad (Single Source of Truth)  
> **Fecha de Actualización:** 2026-08-13  
> **Proyectos:** `sigo-wm` (Angular/TypeScript) · `sigo_wm_mobile` (Flutter/Dart) · `Supabase` (PostgreSQL / Storage)

---

## 🗺️ HALLAZGO H-01: Bug "Mapa en Blanco" en Cotización a Orden de Venta (Web Angular)

### **Síntoma Reportado**
Al convertir una Cotización a Orden de Venta en el módulo comercial, el mapa de ubicación del cliente se borraba o aparecía en blanco sin marcadores ni coordenadas.

### **Causa Raíz Identificada**
1. En `comercial-list.component.ts`, la función `onEstadoChange` reiniciaba el formulario de conversión instanciando un nuevo objeto `conversionConfig` que no preservaba `lat_destino` ni `lng_destino` de la cotización original.
2. La inyección del mapa Leaflet no consideraba el tiempo de renderizado del modal PrimeNG ni ejecutaba `invalidateSize()`, provocando que el contenedor `<div id="map">` tuviera dimensiones cero al inicializar.

### **Resolución Aplicada**
* **Archivo Modificado:** `sigo-wm/src/app/features/comercial/comercial-list/comercial-list.component.ts`
* **Cambios:**
  - Preservación explícita de `lat_destino` y `lng_destino` al seleccionar el estado "Aprobada / Orden de Venta".
  - Gestión limpia del ciclo de vida del mapa Leaflet: limpieza de instancia anterior con `destroyConversionMap()`, inicialización asíncrona dentro de `setTimeout` tras render del DOM, marcador interactivo y invocación a `map.invalidateSize()`.
* **Verificación:** Compilación TypeScript limpia (`npx tsc --noEmit` sin errores).

---

## 🧭 HALLAZGO H-02: Botón de Navegación GPS (Google Maps / Waze) en Mobile

### **Síntoma Reportado**
El chofer en `sigo_wm_mobile` no contaba con un acceso directo y visible para iniciar navegación GPS hacia el destino de entrega del viaje asignado.

### **Causa Raíz Identificada**
1. En `chofer_viaje_detail_screen.dart`, cuando un viaje se cargaba en modo offline desde SQLite (`localViaje`), el mapa `_activeTrip` omitía `lat_destino`, `lng_destino` y `lugar_entrega`.
2. La UI solo mostraba un enlace simple condicionado de Google Maps y no ofrecía alternativa para Waze ni búsqueda por dirección cuando no había coordenadas GPS exactas.

### **Resolución Aplicada**
* **Archivos Modificados:** 
  - `sigo_wm_mobile/lib/features/chofer/screens/chofer_viaje_detail_screen.dart`
* **Cambios:**
  - Se añadieron `lat_destino`, `lng_destino` y `lugar_entrega` al objeto `_activeTrip` en el fallback offline.
  - Se diseñó una interfaz con dos botones principales destacados de alto contraste:
    1. 🗺️ **GOOGLE MAPS**: Ejecuta `https://www.google.com/maps/dir/?api=1&destination=lat,lng` vía `url_launcher`.
    2. 🧭 **WAZE**: Ejecuta `https://waze.com/ul?ll=lat,lng&navigate=yes` vía `url_launcher`.
  - Fallback por dirección: Si no hay coordenadas GPS pero sí `direccion_entrega_detalle`, se habilita el botón 🔍 **BUSCAR DIRECCIÓN EN GOOGLE MAPS**.
  - Si ambos faltan, se presenta una alerta clara en la interfaz para el chofer.
* **Verificación:** Ejecución de `flutter analyze` reportó **0 errores y 0 warnings**.

---

## 📸 HALLAZGO H-03: Pérdida de Fotos de Evidencia de Despacho (Mobile / Supabase)

### **Síntoma Reportado**
Las fotos de evidencia tomadas durante el despacho a veces no se visualizaban en la plataforma web `sigo-wm`.

### **Causa Raíz Identificada**
1. **Carrera en Sincronización:** En `viajes_local_service.dart`, la función `sincronizarPendientes()` comprobaba si la cabecera del viaje ya existía en Supabase (`yaExiste != null`). Si existía con el mismo ID pero la subida inicial de la foto había fallado o enviado `fotos_urls` nulo, la lógica marcaba el viaje como sincronizado (`sincronizado = 1`) y descartaba la foto local sin reintentar la subida ni actualizar `fotos_urls`.
2. **Políticas de Storage RLS:** Se verificó mediante consulta directa a la base de datos PostgreSQL de Supabase que el bucket `assets` es **público** y cuenta con la política `SELECT` activa para la función `{public}` (`"Todos pueden leer assets"`).

### **Resolución Aplicada**
* **Archivos Modificados:**
  - `sigo_wm_mobile/lib/features/despachos/services/viajes_local_service.dart`
* **Cambios:**
  - Se incluyó `fotos_urls` en la consulta `select('id, fotos_urls')` al verificar `yaExiste`.
  - Si el viaje ya existe en Supabase pero `fotos_urls` en la nube está vacío/nulo y en el dispositivo existen archivos en `fotoPath`, el servicio reintenta subir la evidencia a Storage, actualiza la columna `fotos_urls` en `despachos_viajes_cabecera` y únicamente después de ello marca el registro como sincronizado.
* **Verificación:** Inspección directa vía consultas SQL a la base de datos de producción y validación estática en Dart (`flutter analyze`).

---

## 🛠️ VERIFICACIÓN INTEGRAL DE CALIDAD Y COMPILACIÓN

| Proyecto | Herramienta de Validación | Resultado |
| :--- | :--- | :--- |
| `sigo-wm` | `npx tsc --noEmit` | ✅ 0 errores de sintaxis o tipos |
| `sigo_wm_mobile` | `flutter analyze` | ✅ 0 errores, 0 advertencias |
| Supabase RLS | `pg` SQL direct query | ✅ Bucket `assets` público con lectura habilitada |

---
*Fin de la Base de Hechos - Actualizado por Agente Principal de Resolución de Problemas Logística.*
