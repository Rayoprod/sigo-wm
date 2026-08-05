import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Pedidos, PedidosItems, ConfiguracionEmpresa } from '../models/app.models';

declare let pdfMake: any;

@Injectable({ providedIn: 'root' })
export class PdfService {
  supabase = inject(SupabaseService).client;

  // ── Utilidades ───────────────────────────────────────────────────────────

  private async cargarImagen(url: string | null | undefined): Promise<string | null> {
    if (!url) return null;
    if (url.startsWith('data:')) return url;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(url, { mode: 'cors', credentials: 'omit', signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) {
        console.error('Error fetching image:', response.statusText);
        return null;
      }
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) return null;
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch (e) { 
      console.error('Exception fetching image:', e);
      return null; 
    }
  }

  private formatearTextoLargo(texto: string): string {
    if (!texto) return '';
    return texto.split(' ')
      .map(p => p.length > 30 ? p.match(/.{1,30}/g)?.join('\u200B') : p)
      .join(' ');
  }

  private color(empresa: ConfiguracionEmpresa | Partial<ConfiguracionEmpresa> | null): string {
    return empresa?.color_hex || empresa?.color || '#01696f';
  }

  private formatNumber(value: number): string {
    if (value == null || isNaN(value)) return '0.00';
    return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ── Método principal ─────────────────────────────────────────────────────

  async getPdfData(pedidoId: string) {
    const { data: pedido, error: errPedido } = await this.supabase
      .from('pedidos')
      .select('*, clientes(nombre_razon_social, documento_identidad, direccion, telefono, correo), usuarios:usuarios!pedidos_vendedor_id_fkey(correo, nombre_completo)')
      .eq('id', pedidoId)
      .single();

    if (errPedido) throw errPedido;

    const { data: items } = await this.supabase
      .from('pedidos_items')
      .select('*, productos(codigo_sku, descripcion, unidad_medida)')
      .eq('pedido_id', pedidoId);

    const { data: config } = await this.supabase
      .from('configuracion_empresa')
      .select('*')
      .eq('id', 1)
      .single();

    return { pedido, items: items || [], config };
  }

  async generateComercialPdf(pedidoId: string) {
    try {
      console.log('[PDF TRACE] Iniciando getPdfData...');
      const { pedido, items, config } = await this.getPdfData(pedidoId);
      console.log('[PDF TRACE] getPdfData terminado.', { folio: pedido.folio, numItems: items.length });
      
      const datosEmpresa = config || {};
      const colorEmpresa = this.color(datosEmpresa);
      
      console.log('[PDF TRACE] Iniciando cargarImagen para el logo...');
      const logoConvertido = await this.cargarImagen(datosEmpresa.logo_url);
      console.log('[PDF TRACE] Logo cargado. Generando docDefinition...');

      const isCotizacion = pedido.tipo_documento === 'COTIZACION';
      const docLabel = isCotizacion ? 'COTIZACIÓN' : 'ORDEN DE VENTA';

      const fechaFormat = new Date(pedido.created_at ?? new Date()).toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' });

      const entregaRaw = String(pedido.lugar_entrega || '').toUpperCase().trim();
      let textoEntrega = 'NO ESPECIFICADO';
      if (entregaRaw.includes('CANTERA')) textoEntrega = 'PUESTO EN CANTERA';
      else if (entregaRaw.includes('OBRA')) textoEntrega = `PUESTO EN OBRA ${pedido.direccion_entrega_detalle ? '(' + pedido.direccion_entrega_detalle + ')' : ''}`;

      const obsFinal = pedido.observaciones || '';
      const vendedor = pedido.usuarios?.nombre_completo || pedido.usuarios?.correo || '';
      const tieneIgv = Number(pedido.igv) > 0;

      // ── Header ─────────────────────────────────────────────────────────────
      const headerFn = () => {
        const logoBlock = logoConvertido
          ? { image: logoConvertido, fit: [140, 60], margin: [0, 0, 0, 0] }
          : { text: datosEmpresa.razon_social || 'EMPRESA', color: colorEmpresa, fontSize: 22, bold: true, width: 180, margin: [0, 10, 0, 0] };

        return {
          margin: [40, 20, 40, 0],
          stack: [
            {
              columns: [
                logoBlock,
                {
                  width: '*',
                  stack: [
                    { text: docLabel, fontSize: 14, bold: true, color: '#374151', alignment: 'right', characterSpacing: 1 },
                    { text: `N° ${pedido.folio}`, fontSize: 14, bold: true, color: colorEmpresa, alignment: 'right', margin: [0, 2, 0, 4] },
                    { text: datosEmpresa.razon_social || 'Empresa S.A.C.', fontSize: 9, bold: true, color: '#374151', alignment: 'right' },
                    { text: `RUC: ${datosEmpresa.ruc || '-'}`, fontSize: 9, color: '#6b7280', alignment: 'right' },
                    ...(datosEmpresa.direccion_fiscal ? [{
                      stack: datosEmpresa.direccion_fiscal.replace(/\\n/g, '\n').split('\n').filter((linea: string) => linea.trim() !== '').map((linea: string) => ({
                          text: linea.trim(), fontSize: 7.5, color: '#9ca3af', alignment: 'right', margin: [0, 0, 0, 1]
                        })),
                      margin: [0, 2, 0, 0]
                    }] : []),
                    ...(datosEmpresa.telefonos || datosEmpresa.correo ? [{
                      text: [
                        datosEmpresa.telefonos ? `Tel: ${datosEmpresa.telefonos}` : '',
                        datosEmpresa.telefonos && datosEmpresa.correo ? '  •  ' : '',
                        datosEmpresa.correo || ''
                      ].join(''),
                      fontSize: 7.5, color: '#9ca3af', alignment: 'right', margin: [0, 2, 0, 0]
                    }] : [])
                  ]
                }
              ]
            },
            { canvas: [{ type: 'rect', x: 0, y: 10, w: 515, h: 2.5, color: colorEmpresa, r: 1 }] }
          ]
        };
      };

      // ── Footer ──────────────────────────────────────────
      const footerFn = (currentPage: number, pageCount: number): any => ({
        margin: [40, 0, 40, 15],
        columns: [
          { text: `${datosEmpresa.razon_social || ''} • RUC: ${datosEmpresa.ruc || ''}`, fontSize: 7, color: '#9ca3af' },
          { text: `Página ${currentPage} de ${pageCount}`, fontSize: 7, color: '#9ca3af', alignment: 'right' }
        ]
      });

      // ── Tabla de ítems ────────────────────────────────────────────────────
      const anchosTabla = [24, '*', 38, 38, 62, 70];

      const filasItems: any[] = [
        [
          { text: '#', style: 'thCell' },
          { text: 'DESCRIPCIÓN', style: 'thCell', alignment: 'left' },
          { text: 'UND', style: 'thCell' },
          { text: 'CANT', style: 'thCell' },
          { text: 'P. UNIT', style: 'thCell' },
          { text: 'IMPORTE', style: 'thCell' }
        ],
        ...items.map((item: PedidosItems, i: number) => {
          const bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
          const desc = (item as any).productos ? (item as any).productos.descripcion : item.descripcion_manual;
          const um = (item as any).productos ? (item as any).productos.unidad_medida : item.unidad_medida_manual;
          return [
            { text: (i + 1).toString(), style: 'tdCell', alignment: 'center', fillColor: bg },
            { text: this.formatearTextoLargo(desc), style: 'tdCell', fillColor: bg },
            { text: um || '-', style: 'tdCell', alignment: 'center', fillColor: bg },
            { text: String(item.cantidad), style: 'tdCell', alignment: 'center', fillColor: bg },
            { text: `S/ ${this.formatNumber(item.precio_unitario || 0)}`, style: 'tdCell', alignment: 'right', fillColor: bg },
            { text: `S/ ${this.formatNumber(item.subtotal || 0)}`, style: 'tdCell', alignment: 'right', bold: true, fillColor: bg }
          ];
        })
      ];

      // ── Totales ──────────────
      const tieneDescuento = Number(pedido.descuento_global) > 0;
      const bloqueTotales: any[] = [{
        columns: [
          { width: '*', text: '' },
          {
            width: 200,
            table: {
              widths: ['*', 'auto'],
              body: [
                [
                  { text: 'Subtotal', fontSize: 9, color: '#374151', border: [false, false, false, false], margin: [0, 4, 0, 4] },
                  { text: `S/ ${this.formatNumber(pedido.subtotal)}`, fontSize: 9, alignment: 'right', border: [false, false, false, false], margin: [0, 4, 0, 4] }
                ],
                ...(tieneDescuento ? [[
                  { text: 'Descuento', fontSize: 9, color: '#ef4444', border: [false, false, false, false], margin: [0, 2, 0, 2] },
                  { text: `- S/ ${this.formatNumber(pedido.descuento_global)}`, fontSize: 9, color: '#ef4444', alignment: 'right', border: [false, false, false, false], margin: [0, 2, 0, 2] }
                ]] : []),
                ...(tieneIgv ? [[
                  { text: 'IGV (18%)', fontSize: 9, color: '#6b7280', border: [false, false, false, false], margin: [0, 2, 0, 2] },
                  { text: `S/ ${this.formatNumber(pedido.igv)}`, fontSize: 9, color: '#6b7280', alignment: 'right', border: [false, false, false, false], margin: [0, 2, 0, 2] }
                ]] : []),
                [
                  { text: 'TOTAL', fontSize: 13, bold: true, color: colorEmpresa, border: [false, true, false, false], borderColor: [colorEmpresa, colorEmpresa, colorEmpresa, colorEmpresa], margin: [0, 6, 0, 4] },
                  { text: `S/ ${this.formatNumber(pedido.total)}`, fontSize: 13, bold: true, color: colorEmpresa, alignment: 'right', border: [false, true, false, false], borderColor: [colorEmpresa, colorEmpresa, colorEmpresa, colorEmpresa], margin: [0, 6, 0, 4] }
                ]
              ]
            },
            layout: { hLineWidth: (i: number) => i === 0 ? 0 : 0.5, vLineWidth: () => 0, hLineColor: () => '#e5e7eb' }
          }
        ],
        margin: [0, 8, 0, 0]
      }];

      // ── Condiciones ─────────
      const cuentas: any[] = datosEmpresa.cuentas_bancarias_json || [];
      const mostrarCuentas = cuentas.length > 0; 

      const colCondiciones: any[] = [
        { text: 'CONDICIONES COMERCIALES', fontSize: 8, bold: true, color: colorEmpresa, margin: [0, 0, 0, 6] },
        { text: [{ text: '• Lugar de entrega: ', bold: true, fontSize: 7.5 }, { text: textoEntrega, fontSize: 7.5 }], margin: [0, 0, 0, 3] },
        { text: [{ text: '• Impuestos: ', bold: true, fontSize: 7.5 }, { text: tieneIgv ? 'Los precios incluyen IGV (18%)' : 'Los precios NO incluyen IGV', fontSize: 7.5 }], margin: [0, 0, 0, 3] },
      ];

      if (isCotizacion && pedido.dias_validez_oferta) {
        colCondiciones.push(
          { text: [{ text: '• Validez: ', bold: true, fontSize: 7.5 }, { text: `${pedido.dias_validez_oferta} días calendario`, fontSize: 7.5 }], margin: [0, 0, 0, 3] }
        );
      }

      if (vendedor) {
        colCondiciones.push({ text: [{ text: '• Vendedor: ', bold: true, fontSize: 7.5 }, { text: vendedor, fontSize: 7.5 }], margin: [0, 0, 0, 3] });
      }

      if (obsFinal) {
        colCondiciones.push({ text: [{ text: '• Observaciones: ', bold: true, fontSize: 7.5 }, { text: obsFinal, fontSize: 7.5 }], margin: [0, 0, 0, 3] });
      }

      const colPago: any[] = [];

      if (mostrarCuentas) {
        colPago.push({ text: 'DATOS PARA PAGO', fontSize: 8, bold: true, color: colorEmpresa, margin: [0, 0, 0, 6] });
        cuentas.forEach((c: any) => {
          const bancoName = c.banco || 'Banco';
          const monedaName = c.moneda === 'USD' ? 'Dólares' : (c.moneda === 'PEN' ? 'Soles' : (c.moneda || 'Soles'));
          const numCuenta = c.numero_cuenta || c.numeroCuenta || c.numero || c.cuenta || '-';

          colPago.push({ text: `• ${bancoName} (${monedaName})`, fontSize: 7.5, bold: true, margin: [0, 0, 0, 1] });
          colPago.push({ text: `  Nro: ${numCuenta}`, fontSize: 7, color: '#374151', margin: [0, 0, 0, 1] });
          if (c.cci) colPago.push({ text: `  CCI: ${c.cci}`, fontSize: 6.5, color: '#6b7280', margin: [0, 0, 0, 4] });
          else colPago.push({ text: '', margin: [0, 0, 0, 3] });
        });
      }

      const termsCondition = datosEmpresa.terminos_condiciones_pie ? datosEmpresa.terminos_condiciones_pie : '';
      if (termsCondition && colCondiciones.length > 0) {
        colCondiciones.push({ text: [{ text: '• Términos: ', bold: true, fontSize: 7.5 }, { text: termsCondition, fontSize: 7.5 }], margin: [0, 0, 0, 3] });
      }

      const bloqueCondicionesContent: any = {
        margin: [0, 20, 0, 0],
        unbreakable: true,
        table: {
          widths: mostrarCuentas ? ['*', 200] : ['*'],
          body: [
            mostrarCuentas
              ? [
                { stack: colCondiciones, border: [false, false, false, false], margin: [12, 12, 12, 12] },
                { stack: colPago, border: [false, false, false, false], margin: [12, 12, 12, 12], fillColor: '#f3f4f6' }
              ]
              : [
                { stack: colCondiciones, border: [false, false, false, false], margin: [12, 12, 12, 12] }
              ]
          ]
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: (i: number, node: any) => i === 0 || i === node.table.widths.length ? 0.5 : 0.3,
          hLineColor: () => '#e5e7eb',
          vLineColor: () => '#e5e7eb',
          fillColor: () => '#fafbfc'
        }
      };

      // ── Firma ────────────────────────────────────────────────────
      const bloqueFirma: any = { text: '', margin: [0, 0, 0, 0] };

      // ── Cliente ────────────────────────────────
      const cNombre = pedido.clientes?.nombre_razon_social || '—';
      const cDoc = pedido.clientes?.documento_identidad || '—';
      const cDir = pedido.clientes?.direccion;
      const cTel = pedido.clientes?.telefono;
      const cCor = pedido.clientes?.correo;

      const cajaCliente: any = {
        margin: [0, 0, 0, 16],
        table: {
          widths: ['*'],
          body: [[{
            columns: [
              {
                width: '*',
                stack: [
                  { text: 'SEÑOR(ES):', fontSize: 7, color: '#9ca3af', margin: [0, 0, 0, 3] },
                  { text: cNombre, bold: true, fontSize: 11, color: '#111827', margin: [0, 0, 0, 4] },
                  { text: [{ text: 'RUC / DNI: ', bold: true, fontSize: 8.5 }, { text: cDoc, fontSize: 8.5 }], margin: [0, 0, 0, 2] },
                  ...(cDir ? [{ text: [{ text: 'Dirección: ', bold: true, fontSize: 8 }, { text: cDir, fontSize: 8 }], margin: [0, 2, 0, 0] }] : [])
                ]
              },
              {
                width: 180,
                stack: [
                  { text: [{ text: 'Fecha: ', bold: true, fontSize: 8.5 }, { text: fechaFormat, fontSize: 8.5 }], alignment: 'right', margin: [0, 0, 0, 3] },
                  ...(cTel ? [{ text: [{ text: 'Teléfono: ', bold: true, fontSize: 8 }, { text: cTel, fontSize: 8 }], alignment: 'right', margin: [0, 0, 0, 2] }] : []),
                  ...(cCor ? [{ text: [{ text: 'Correo: ', bold: true, fontSize: 8 }, { text: cCor, fontSize: 8 }], alignment: 'right' }] : [])
                ]
              }
            ],
            border: [true, true, true, true],
            borderColor: ['#e5e7eb', '#e5e7eb', '#e5e7eb', '#e5e7eb'],
            fillColor: '#f8fafc',
            margin: [12, 10, 12, 10]
          }]]
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#e5e7eb',
          vLineColor: () => '#e5e7eb'
        }
      };

      // ── Documento final ───────────────────────────────────────────────
      const docDefinition: any = {
        pageSize: 'A4',
        pageMargins: [40, 125, 40, 40],
        watermark: pedido.estado === 'ANULADA' 
          ? { text: 'ANULADO', color: '#ef4444', opacity: 0.3, bold: true, italics: false }
          : { text: isCotizacion ? 'COTIZACIÓN' : 'ORDEN DE VENTA', color: colorEmpresa, opacity: 0.04, bold: true, italics: false },
        header: headerFn,
        footer: footerFn,
        content: [
          cajaCliente,
          {
            table: {
              headerRows: 1,
              widths: anchosTabla,
              body: filasItems,
              dontBreakRows: true
            },
            layout: {
              hLineWidth: (i: number, node: any) => (i === 0 || i === 1 || i === node.table.body.length) ? 1.2 : 0.4,
              vLineWidth: () => 0,
              hLineColor: (i: number, node: any) => (i === 0 || i === 1 || i === node.table.body.length) ? colorEmpresa : '#e5e7eb',
              paddingTop: () => 5,
              paddingBottom: () => 5,
              paddingLeft: () => 4,
              paddingRight: () => 4
            }
          },
          ...bloqueTotales,
          bloqueCondicionesContent,
          bloqueFirma
        ],
        styles: {
          thCell: { bold: true, fontSize: 8.5, color: 'white', fillColor: colorEmpresa, alignment: 'center', margin: [4, 6, 4, 6] },
          tdCell: { fontSize: 8.5, margin: [4, 6, 4, 6], color: '#374151' }
        },
        defaultStyle: {
          columnGap: 20
        }
      };

      const nombreEmpresa = (datosEmpresa.razon_social || 'empresa').replace(/\s+/g, '_');
      const nombreCliente = cNombre.replace(/\s+/g, '_');
      const nombreArchivo = `${pedido.folio}_${nombreEmpresa}_${nombreCliente}.pdf`;
      
      console.log('[PDF TRACE] docDefinition construido correctamente. Preparando pdfMake (vía CDN)...');
      
      if (typeof pdfMake === 'undefined') {
          console.error('[PDF TRACE] pdfMake no está definido globalmente.');
          alert('Error crítico: La librería de PDFs no se cargó correctamente en tu navegador. Intenta recargar la página.');
          return;
      }

      // Promisify getBlob to avoid lost errors
      return new Promise<void>((resolve, reject) => {
        try {
          console.log('[PDF TRACE] Llamando a pdfMake.createPdf con el doc real...');
          const pdfDocGenerator = pdfMake.createPdf(docDefinition);
             
          console.log('[PDF TRACE] createPdf ejecutado. Llamando a getBlob real...');
          pdfDocGenerator.getBlob(async (blob: Blob) => {
             console.log('[PDF TRACE] getBlob callback ejecutado! Blob size:', blob.size);
            try {
              const file = new File([blob], nombreArchivo, { type: 'application/pdf' });
              const blobUrl = URL.createObjectURL(blob);
              
              const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
              
              // 1. Share nativo (Solo si es móvil)
              if (isMobile && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                  await navigator.share({
                    title: `Documento ${pedido.folio}`,
                    text: `Adjunto documento ${pedido.folio}`,
                    files: [file]
                  });
                  resolve();
                  return;
                } catch (err: any) {
                  if (err.name === 'AbortError') { resolve(); return; }
                }
              }
              
              // 2. Descarga directa para Web (Desktop) o si falla el share en móvil
              console.log('[PDF TRACE] Descargando archivo directamente...');
              const a = document.createElement('a');
              a.href = blobUrl;
              a.download = nombreArchivo;
              a.style.display = 'none';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              
              // Limpiar memoria
              setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
              resolve();
            } catch (innerE) {
              reject(innerE);
            }
          });
        } catch (e: any) {
          reject(e);
        }
      });

    } catch (e: any) {
      console.error('PdfService Fatal:', e);
      throw e;
    }
  }
}
