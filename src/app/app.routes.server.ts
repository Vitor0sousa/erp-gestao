import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    // A sessão fica no navegador; páginas privadas não devem ser pré-renderizadas.
    renderMode: RenderMode.Client
  }
];
