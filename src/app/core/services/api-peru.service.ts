import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ApiPeruService {
  private token = environment.apiPeruToken;

  async buscarDocumento(documento: string) {
    const doc = documento.trim();
    if (doc.length !== 8 && doc.length !== 11) {
      throw new Error('El documento debe tener 8 (DNI) o 11 (RUC) dígitos.');
    }

    const tipo = doc.length === 8 ? 'dni' : 'ruc';
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
