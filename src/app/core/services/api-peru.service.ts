import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { CE_SIN_AUTOCOMPLETAR, getTipoDocumento } from '../../shared/utils/documento-identidad';

@Injectable({
  providedIn: 'root'
})
export class ApiPeruService {
  private token = environment.apiPeruToken;

  async buscarDocumento(documento: string) {
    const doc = documento.trim();
    const tipoDoc = getTipoDocumento(doc);
    if (!tipoDoc) {
      throw new Error('El documento debe ser un DNI (8 dígitos), RUC (11 dígitos) o Carné de Extranjería.');
    }
    if (tipoDoc === 'CE') {
      throw new Error(CE_SIN_AUTOCOMPLETAR);
    }

    const tipo = tipoDoc === 'DNI' ? 'dni' : 'ruc';
    const url = `https://apiperu.dev/api/${tipo}/${doc}`;

    try {
      const respuesta = await fetch(url, {
        method: 'GET',
        headers: { 
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}` 
        }
      });

      let data: any;
      try {
        data = await respuesta.json();
      } catch (err) {
        throw new Error(`Error en el servidor: HTTP ${respuesta.status}`);
      }

      if (!respuesta.ok || data.success === false) {
        const mensaje = data.message || `No se encontraron datos para el documento ${doc}`;
        throw new Error(mensaje);
      }
      
      return data.data ? data.data : data;
    } catch (e: any) {
      throw new Error(e.message || 'Error de conexión con el servicio de validación');
    }
  }
}
