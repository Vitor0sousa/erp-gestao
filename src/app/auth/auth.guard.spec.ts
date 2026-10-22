import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AUTH_CLIENT, authGuard } from './auth.guard';

@Component({ template: 'Login' })
class LoginPage {}

@Component({ template: 'Privado' })
class PrivatePage {
  static created = 0;
  constructor() { PrivatePage.created++; }
}

describe('Proteção das rotas internas', () => {
  let getUser: jasmine.Spy;

  beforeEach(() => {
    PrivatePage.created = 0;
    getUser = jasmine.createSpy('getUser');
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: AUTH_CLIENT, useValue: { auth: { getUser } } },
        provideRouter([
          { path: 'login', component: LoginPage },
          {
            path: '', canActivateChild: [authGuard], children: [
              { path: 'dashboard', component: PrivatePage },
              { path: 'financeiro', component: PrivatePage },
            ],
          },
        ]),
      ],
    });
  });

  it('redireciona acesso direto sem sessão sem criar a página privada', async () => {
    getUser.and.resolveTo({ data: { user: null }, error: null });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dashboard', LoginPage);
    expect(TestBed.inject(Router).url).toBe('/login');
    expect(PrivatePage.created).toBe(0);
  });

  it('aguarda a validação antes de criar a página', async () => {
    let finish!: (value: unknown) => void;
    getUser.and.returnValue(new Promise(resolve => { finish = resolve; }));
    const harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl('/dashboard', PrivatePage);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(PrivatePage.created).toBe(0);
    finish({ data: { user: { id: 'usuario' } }, error: null });
    await navigation;
    expect(PrivatePage.created).toBe(1);
  });

  it('revalida a sessão ao navegar entre páginas internas', async () => {
    getUser.and.resolveTo({ data: { user: { id: 'usuario' } }, error: null });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dashboard', PrivatePage);
    getUser.and.resolveTo({ data: { user: null }, error: { message: 'expired' } });
    await harness.navigateByUrl('/financeiro', LoginPage);
    expect(TestBed.inject(Router).url).toBe('/login');
    expect(PrivatePage.created).toBe(1);
  });

  it('bloqueia acesso quando a validação falha', async () => {
    getUser.and.rejectWith(new Error('Falha de conexão'));
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/financeiro', LoginPage);
    expect(PrivatePage.created).toBe(0);
  });

  it('mantém o login público', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/login', LoginPage);
    expect(getUser).not.toHaveBeenCalled();
  });
});
