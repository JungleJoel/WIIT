import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    // Aktiverar globala error listeners för att fånga upp fel i applikationen, byts/tas bort senare ev.
    provideBrowserGlobalErrorListeners(),
    // Aktiverr routing som definieras i app.routes.ts
    provideRouter(routes)
  ]
};
