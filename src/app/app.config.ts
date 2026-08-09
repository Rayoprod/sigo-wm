import { ApplicationConfig, isDevMode, LOCALE_ID } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { MessageService } from 'primeng/api';
import localeEsPe from '@angular/common/locales/es-PE';

import { routes } from './app.routes';
import { provideServiceWorker } from '@angular/service-worker';

// Registrar el locale de Perú una única vez al arrancar la app.
// Esto permite que DatePipe (y por extensión PeruDatePipe) conozca
// los nombres de meses, días y formatos del español peruano.
registerLocaleData(localeEsPe, 'es-PE');

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAnimations(),
    provideHttpClient(),
    MessageService,
    // Forzar locale es-PE en toda la app (pipes de fecha, moneda, números)
    { provide: LOCALE_ID, useValue: 'es-PE' },
    provideServiceWorker('ngsw-worker.js', {
        enabled: !isDevMode(),
        registrationStrategy: 'registerWhenStable:30000'
    })
]
};
