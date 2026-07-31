import { Pipe, PipeTransform } from '@angular/core';

/**
 * Convierte un valor de roles a array de strings.
 * Maneja los casos:
 *   - Array: ['chofer', 'despachador'] → devuelve tal cual
 *   - String: 'chofer' → devuelve ['chofer']
 *   - null/undefined → devuelve []
 *
 * Necesario porque la columna 'rol' en Supabase es text[],
 * pero datos legacy pueden llegar como string simple.
 */
@Pipe({
  name: 'asArray',
  standalone: true,
  pure: true
})
export class AsArrayPipe implements PipeTransform {
  transform(value: any): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value as string[];
    if (typeof value === 'string') return [value];
    return [];
  }
}
