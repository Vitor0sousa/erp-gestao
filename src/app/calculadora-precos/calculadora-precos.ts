import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

interface ProdutoBusca {
  id: string;
  sku_interno: string;
  nome_produto: string;
  custo_unitario: number;
}

type TipoAnuncio = 'CLASSICO' | 'PREMIUM';
type StatusMargem = 'boa' | 'apertada' | 'ruim';

// ── Taxas fixas do Mercado Livre ──────────────────────────────────────────
// Comissão confirmada pelo usuário: não varia por categoria na conta dele.
const COMISSAO_CLASSICO = 14;
const COMISSAO_PREMIUM = 19;
// Custo fixo aproximado cobrado em itens abaixo de R$79 (aproximação — a
// regra oficial hoje é variável por peso/dimensão, mas sem chamar a API
// esse valor serve como estimativa editável na própria tela).
const CUSTO_FIXO_ABAIXO_79 = 6.0;
const LIMITE_FRETE_GRATIS_OBRIGATORIO = 79;
const CUSTO_FRETE_PADRAO = 18.0;
// ────────────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-calculadora-precos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './calculadora-precos.html',
  styleUrl: './calculadora-precos.css'
})
export class CalculadoraPrecosComponent implements OnInit {
  produtos = signal<ProdutoBusca[]>([]);
  isLoadingProdutos = signal(true);

  buscaProduto = signal('');
  produtoSelecionado = signal<ProdutoBusca | null>(null);

  resultadosBusca = computed(() => {
    const termo = this.buscaProduto().toLowerCase().trim();
    if (!termo) return [];
    return this.produtos().filter(p =>
      p.sku_interno.toLowerCase().includes(termo) ||
      p.nome_produto.toLowerCase().includes(termo)
    ).slice(0, 8);
  });

  // ── Campos editáveis da calculadora ──
  custoProduto = signal<number>(0);
  tipoAnuncio = signal<TipoAnuncio>('CLASSICO');
  precoVenda = signal<number>(0);
  freteGratisManual = signal(false);
  custoFreteEstimado = signal<number>(CUSTO_FRETE_PADRAO);

  // ── Cálculos ao vivo ──
  comissaoPercentual = computed(() =>
    this.tipoAnuncio() === 'PREMIUM' ? COMISSAO_PREMIUM : COMISSAO_CLASSICO
  );

  comissaoValor = computed(() =>
    this.precoVenda() * (this.comissaoPercentual() / 100)
  );

  custoFixo = computed(() =>
    this.precoVenda() > 0 && this.precoVenda() < LIMITE_FRETE_GRATIS_OBRIGATORIO
      ? CUSTO_FIXO_ABAIXO_79
      : 0
  );

  freteGratisObrigatorio = computed(() =>
    this.precoVenda() >= LIMITE_FRETE_GRATIS_OBRIGATORIO
  );

  freteGratisAtivo = computed(() =>
    this.freteGratisObrigatorio() || this.freteGratisManual()
  );

  custoFrete = computed(() =>
    this.freteGratisAtivo() ? this.custoFreteEstimado() : 0
  );

  custoTotal = computed(() =>
    this.custoProduto() + this.comissaoValor() + this.custoFixo() + this.custoFrete()
  );

  lucro = computed(() =>
    this.precoVenda() - this.custoTotal()
  );

  margem = computed(() =>
    this.precoVenda() > 0 ? (this.lucro() / this.precoVenda()) * 100 : 0
  );

  statusMargem = computed<StatusMargem>(() => {
    const m = this.margem();
    if (m >= 20) return 'boa';
    if (m >= 10) return 'apertada';
    return 'ruim';
  });

  private supabase: SupabaseClient;

  constructor(private router: Router) {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseKey);
  }

  ngOnInit() {
    this.verificarSessao();
    this.carregarProdutos();
  }

  async verificarSessao() {
    const { data } = await this.supabase.auth.getSession();
    if (!data.session) this.router.navigate(['/login']);
  }

  async carregarProdutos() {
    this.isLoadingProdutos.set(true);
    try {
      const { data, error } = await this.supabase
        .from('produtos_internos')
        .select('id, sku_interno, nome_produto, custo_unitario')
        .order('nome_produto', { ascending: true });

      if (error) throw error;

      this.produtos.set((data || []).map(p => ({
        ...p,
        custo_unitario: p.custo_unitario || 0
      })));
    } catch (error) {
      console.error('Erro ao carregar produtos:', error);
    } finally {
      this.isLoadingProdutos.set(false);
    }
  }

  async selecionarProduto(produto: ProdutoBusca) {
    this.produtoSelecionado.set(produto);
    this.custoProduto.set(produto.custo_unitario || 0);
    this.buscaProduto.set('');
    this.freteGratisManual.set(false);

    // Tenta pré-preencher o preço de venda com o preço do anúncio ML vinculado
    try {
      const { data: link } = await this.supabase
        .from('anuncio_skus')
        .select('anuncio_id')
        .eq('produto_interno_id', produto.id)
        .limit(1)
        .single();

      if (link?.anuncio_id) {
        const { data: anuncio } = await this.supabase
          .from('meli_anuncios')
          .select('preco')
          .eq('id', link.anuncio_id)
          .single();

        if (anuncio?.preco) {
          this.precoVenda.set(anuncio.preco);
          return;
        }
      }
    } catch {
      // Sem vínculo de anúncio — sem problema, usuário digita o preço manualmente
    }

    this.precoVenda.set(0);
  }

  trocarProduto() {
    this.produtoSelecionado.set(null);
    this.custoProduto.set(0);
    this.precoVenda.set(0);
    this.freteGratisManual.set(false);
    this.custoFreteEstimado.set(CUSTO_FRETE_PADRAO);
  }

  selecionarTipoAnuncio(tipo: TipoAnuncio) {
    this.tipoAnuncio.set(tipo);
  }

  toggleFreteGratisManual() {
    if (this.freteGratisObrigatorio()) return; // travado, não faz nada
    this.freteGratisManual.set(!this.freteGratisManual());
  }
}