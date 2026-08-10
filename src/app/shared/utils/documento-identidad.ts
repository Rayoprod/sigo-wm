/**
 * Utilidades compartidas para identificar el tipo de documento de identidad
 * (DNI, RUC o Carné de Extranjería) a partir del texto ingresado.
 */

export type TipoDocumento = 'DNI' | 'RUC' | 'CE';

/** Mensaje mostrado cuando el usuario intenta autocompletar un CE. */
export const CE_SIN_AUTOCOMPLETAR =
  'El Carné de Extranjería no se autocompleta con SUNAT/RENIEC. Ingresa los datos del cliente manualmente.';

/**
 * Clasifica un documento según su formato:
 *  - DNI: 8 dígitos numéricos.
 *  - RUC: 11 dígitos numéricos.
 *  - CE:  letra inicial + 7 a 11 dígitos (formato actual, ej. A12345678)
 *        o numérico de 9 a 10 dígitos (CE antiguos).
 *
 * Devuelve null si el formato no es reconocible.
 */
export function getTipoDocumento(documento: string | null | undefined): TipoDocumento | null {
  const doc = (documento || '').trim();
  if (!doc) return null;

  if (/^\d{8}$/.test(doc)) return 'DNI';
  if (/^\d{11}$/.test(doc)) return 'RUC';

  if (/^[A-Za-z]\d{7,11}$/.test(doc)) return 'CE';
  if (/^\d{9,10}$/.test(doc)) return 'CE';

  return null;
}
