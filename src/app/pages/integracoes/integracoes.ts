import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AUTH_CLIENT } from '../../auth/auth.guard';
import { environment } from '../../../environments/environment';

interface ContaMarketplace {
  id: string;
  nome_conta: string | null;
  seller_id_meli: string;
}

const MARKETPLACES = [
  {
    id: 'mercado-livre',
    nome: 'Mercado Livre',
    oauth: {
      functionName: 'meli-oauth-start',
      origin: 'https://auth.mercadolivre.com.br',
      pathname: '/authorization',
    },
  },
  { id: 'shopee', nome: 'Shopee', oauth: null },
] as const;

type Marketplace = typeof MARKETPLACES[number];

@Component({
  selector: 'app-integracoes',
  templateUrl: './integracoes.html',
  styleUrl: './integracoes.css',
})
export class IntegracoesComponent implements OnInit {
  private readonly supabase = inject(AUTH_CLIENT);
  private readonly retorno = inject(ActivatedRoute).snapshot.queryParamMap;
  readonly statusOAuth = this.retorno.get('status');
  private readonly contaRetornoId = this.retorno.get('conta_id');
  readonly marketplaces = MARKETPLACES;
  readonly oauthHabilitado = 'meliOAuthEnabled' in environment && environment.meliOAuthEnabled === true;
  readonly contas = signal<ContaMarketplace[]>([]);
  readonly carregando = signal(false);
  readonly conectando = signal(false);
  readonly erroContas = signal(false);
  readonly erroConexao = signal(false);
  readonly contaConfirmada = computed(() => this.statusOAuth === 'connected'
    ? this.contas().find(conta => conta.id === this.contaRetornoId)
    : undefined);

  ngOnInit(): void {
    void this.carregarContas();
  }

  async carregarContas(): Promise<void> {
    if (this.carregando()) return;

    this.carregando.set(true);
    this.erroContas.set(false);
    try {
      const { data, error } = await this.supabase.from('meli_contas')
        .select('id,nome_conta,seller_id_meli')
        .order('nome_conta')
        .order('id')
        .returns<ContaMarketplace[]>();
      if (error) throw error;
      this.contas.set(data ?? []);
    } catch {
      this.erroContas.set(true);
    } finally {
      this.carregando.set(false);
    }
  }

  async conectar(marketplace: Marketplace): Promise<void> {
    const { oauth } = marketplace;
    if (!oauth || !this.oauthHabilitado || this.conectando()) return;

    this.conectando.set(true);
    this.erroConexao.set(false);
    try {
      const { data, error } = await this.supabase.functions
        .invoke<{ authorizationUrl: string }>(oauth.functionName, { method: 'POST' });
      if (error || !data?.authorizationUrl) throw new Error('Autorização indisponível');

      const url = new URL(data.authorizationUrl);
      if (url.origin !== oauth.origin || url.pathname !== oauth.pathname || url.username || url.password) {
        throw new Error('Destino de autorização inválido');
      }
      window.location.assign(url.href);
    } catch {
      this.erroConexao.set(true);
      this.conectando.set(false);
    }
  }
}
