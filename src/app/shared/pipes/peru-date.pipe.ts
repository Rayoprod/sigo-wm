import { Pipe, PipeTransform } from '@angular/core';
import { DatePipe } from '@angular/common';

/**
 * Zona horaria oficial de Per\u00fa (America/Lima = UTC\u22125, sin cambio de horario).
 * Centralizada aqu\u00ed para que cualquier cambio futuro solo requiera
 * modificar este archivo.
 */
export const PERU_TIMEZONE = 'America/Lima';

/**
 * Locale oficial de Per\u00fa para Angular.
 * Controla el idioma de nombres de mes, d\u00eda, separadores, etc.
 */
export const PERU_LOCALE = 'es-PE';

/**
 * PeruDatePipe
 *
 * Pipe standalone que extiende el DatePipe nativo de Angular
 * forzando siempre la zona horaria de Per\u00fa (America/Lima)
 * y el locale es-PE, independientemente del navegador del usuario.
 *
 * Uso en template:
 *   {{ valor | peruDate }}                    \u2192 '08/08/2026 10:30'
 *   {{ valor | peruDate:'dd/MM/yyyy' }}        \u2192 '08/08/2026'
 *   {{ valor | peruDate:'dd MMM yyyy, HH:mm' }} \u2192 '08 ago. 2026, 10:30'
 *
 * Acepta los mismos format strings que el DatePipe de Angular:
 *   https://angular.io/api/common/DatePipe#pre-defined-format-options
 */
@Pipe({
  name: 'peruDate',
  standalone: true,
  pure: true  // pure = true: solo recalcula cuando el valor de entrada cambia
})
export class PeruDatePipe implements PipeTransform {
  /** Instancia privada del DatePipe oficial de Angular con locale peruano. */
  private readonly datePipe = new DatePipe(PERU_LOCALE);

  /**
   * @param value   Fecha como string ISO, timestamp en ms, o Date object.
   * @param format  Formato Angular DatePipe (default: 'dd/MM/yyyy HH:mm').
   * @returns       String formateado en hora de Lima, o null si el valor es nulo/inv\u00e1lido.
   */
  transform(
    value: Date | string | number | null | undefined,
    format: string = 'dd/MM/yyyy HH:mm'
  ): string | null {
    if (value == null) return null;
    if (typeof value === 'string') {
      value = value.replace(' ', 'T');
    }
    return this.datePipe.transform(value, format, PERU_TIMEZONE) ?? null;
  }
}
