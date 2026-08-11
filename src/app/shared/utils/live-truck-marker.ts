// src/app/shared/utils/live-truck-marker.ts
// Helper del marcador de camión en vivo, compartido por rastreo-cliente y logistica
// para tener una única fuente de verdad (CSS + construcción del ícono Leaflet).
import * as L from 'leaflet';

export type LiveTruckState = 'moving' | 'stopped' | 'no_signal';

const STYLES_ID = 'sigo-live-truck-styles';
let stylesInjected = false;

/**
 * Inyecta los estilos CSS del marcador de camión en vivo (una sola vez en <head>).
 * Se usa en lugar del SCSS de los componentes para que los estilos alcancen
 * los elementos creados dinámicamente por Leaflet fuera del shadow DOM.
 */
function injectLiveMarkerStyles(): void {
  if (stylesInjected || document.getElementById(STYLES_ID)) return;
  const style = document.createElement('style');
  style.id = STYLES_ID;
  style.textContent = `
    .sigo-truck-wrap { display:flex; flex-direction:column; align-items:center; gap:2px; }
    .sigo-truck-circle {
      width:42px; height:42px; border-radius:50%;
      border:3px solid rgba(255,255,255,0.95);
      display:flex; align-items:center; justify-content:center;
      font-size:20px; position:relative; cursor:pointer;
      transition: background 0.4s ease;
    }
    .sigo-truck-badge {
      font-size:9px; font-weight:700; color:white;
      padding:2px 6px; border-radius:6px;
      white-space:nowrap; letter-spacing:0.4px;
      box-shadow:0 1px 4px rgba(0,0,0,0.3);
    }
    /* En movimiento — azul pulsante */
    .sigo-truck-moving .sigo-truck-circle {
      background:#2563eb;
      animation: sigoTruckPulse 2s ease-in-out infinite;
    }
    .sigo-truck-moving .sigo-truck-badge  { background:#1d4ed8; }
    /* Detenido — ámbar */
    .sigo-truck-stopped .sigo-truck-circle {
      background:#f59e0b;
      box-shadow:0 3px 14px rgba(245,158,11,0.5);
    }
    .sigo-truck-stopped .sigo-truck-badge  { background:#d97706; }
    /* Sin señal — gris pizarra */
    .sigo-truck-nosignal .sigo-truck-circle {
      background:#64748b;
      box-shadow:0 3px 14px rgba(100,116,139,0.35);
      opacity:0.85;
    }
    .sigo-truck-nosignal .sigo-truck-badge { background:#475569; }
    @keyframes sigoTruckPulse {
      0%,100% { box-shadow:0 3px 14px rgba(37,99,235,0.55), 0 0 0 0   rgba(37,99,235,0.35); }
      60%     { box-shadow:0 3px 14px rgba(37,99,235,0.55), 0 0 0 14px rgba(37,99,235,0);   }
    }
  `;
  document.head.appendChild(style);
  stylesInjected = true;
}

/**
 * Crea el ícono Leaflet del camión en vivo con apariencia diferenciada según estado.
 *
 * @param state          'moving' | 'stopped' | 'no_signal'
 * @param edadMin        Minutos desde el último punto GPS
 * @param labelOverrides Etiquetas opcionales por estado (para personalizar el texto por vista)
 */
export function buildLiveTruckIcon(
  state: LiveTruckState,
  edadMin: number,
  labelOverrides: Partial<Record<LiveTruckState, string>> = {}
): L.DivIcon {
  injectLiveMarkerStyles();

  const safeEdad = Number.isFinite(edadMin) && edadMin >= 0 ? Math.round(edadMin) : 0;

  const defaultLabels: Record<LiveTruckState, string> = {
    moving:    '▶ En movimiento',
    stopped:   `⏸ Detenido · ${safeEdad}m`,
    no_signal: `📡 Sin señal · ${safeEdad}m`
  };

  const clsMap: Record<LiveTruckState, string> = {
    moving:    'sigo-truck-moving',
    stopped:   'sigo-truck-stopped',
    no_signal: 'sigo-truck-nosignal'
  };

  const label = labelOverrides[state] ?? defaultLabels[state];
  const html = `<div class="sigo-truck-wrap ${clsMap[state]}">
    <div class="sigo-truck-circle">🚛</div>
    <div class="sigo-truck-badge">${label}</div>
  </div>`;

  return L.divIcon({
    className: '',
    html,
    iconSize:    [88, 60],
    iconAnchor:  [44, 21],
    popupAnchor: [0, -24]
  });
}
