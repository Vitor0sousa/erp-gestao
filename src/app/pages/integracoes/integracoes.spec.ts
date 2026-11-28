import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../app.routes';
import { AUTH_CLIENT } from '../../auth/auth.guard';

describe('Rota de integrações', () => {
  const getUser = jasmine.createSpy('getUser');
  const from = jasmine.createSpy('from');
  const returns = jasmine.createSpy('returns');

  beforeEach(() => {
    getUser.calls.reset();
    from.calls.reset();
    const query = {
      select: () => query,
      order: () => query,
      returns,
    };
    from.and.returnValue(query);
    returns.and.resolveTo({
      data: [{ id: 'conta-a', nome_conta: 'Luzza', seller_id_meli: '123' }],
      error: null,
    });

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter(routes),
        { provide: AUTH_CLIENT, useValue: { auth: { getUser }, from } },
      ],
    });
  });

  it('redireciona para o login sem consultar contas quando não existe sessão', async () => {
    getUser.and.resolveTo({ data: { user: null }, error: null });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/integracoes');

    expect(TestBed.inject(Router).url).toBe('/login');
    expect(from).not.toHaveBeenCalled();
  });

  it('carrega a página protegida e apresenta Mercado Livre e Shopee', async () => {
    getUser.and.resolveTo({ data: { user: { id: 'erp-user' } }, error: null });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/integracoes');
    await harness.fixture.whenStable();

    const layout = harness.routeNativeElement!;
    expect(TestBed.inject(Router).url).toBe('/integracoes');
    expect(from).toHaveBeenCalledOnceWith('meli_contas');
    expect(layout.querySelector('a[href="/integracoes"]')?.getAttribute('aria-current'))
      .toBe('page');
    expect(layout.querySelector('app-integracoes')?.textContent).toContain('Mercado Livre · Luzza');
    expect(layout.querySelector('section[aria-labelledby="shopee"]')?.textContent)
      .toContain('Em breve');
  });

  it('confirma na listagem a loja retornada pelo OAuth', async () => {
    getUser.and.resolveTo({ data: { user: { id: 'erp-user' } }, error: null });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/integracoes?status=connected&conta_id=conta-a');
    await harness.fixture.whenStable();

    expect(harness.routeNativeElement?.querySelector('[role="status"]')?.textContent)
      .toContain('Mercado Livre · Luzza');
  });

  it('não confirma uma loja ausente da listagem', async () => {
    getUser.and.resolveTo({ data: { user: { id: 'erp-user' } }, error: null });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/integracoes?status=connected&conta_id=outra-conta');
    await harness.fixture.whenStable();

    expect(harness.routeNativeElement?.querySelector('[role="alert"]')?.textContent)
      .toContain('ainda não aparece na lista');
  });

});
