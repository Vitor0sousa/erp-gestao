import { isPlatformBrowser } from '@angular/common';
import { inject, InjectionToken, PLATFORM_ID } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { createClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

export const AUTH_CLIENT = new InjectionToken('AUTH_CLIENT', {
  providedIn: 'root',
  factory: () => createClient(environment.supabaseUrl, environment.supabaseKey),
});

// O router aguarda a validação antes de criar as páginas e iniciar suas consultas.
export const authGuard: CanActivateChildFn = async () => {
  const router = inject(Router);
  const login = router.createUrlTree(['/login']);

  if (!isPlatformBrowser(inject(PLATFORM_ID))) return login;

  const supabase = inject(AUTH_CLIENT);
  try {
    // getUser valida a sessão no Auth, em vez de confiar apenas no armazenamento local.
    const { data, error } = await supabase.auth.getUser();
    return !error && data.user ? true : login;
  } catch {
    return login;
  }
};
