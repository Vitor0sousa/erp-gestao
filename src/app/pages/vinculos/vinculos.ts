import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AUTH_CLIENT } from '../../auth/auth.guard';

interface Conta { id: string; nome_conta: string; seller_id_meli: string }
interface Produto { id: string; sku_interno: string; nome_produto: string; tipo: string }
interface Variacao { id: string; sku: string | null; nome: string | null }
interface Vinculo { id: string; variacao_id_meli: string | null; produto_interno_id: string }
interface Anuncio {
  id: string;
  item_id_meli: string;
  titulo_anuncio: string;
  sku_marketplace: string | null;
  variacoes_marketplace: Variacao[];
  anuncio_skus: Vinculo[];
}

interface Linha {
  chave: string;
  anuncio: Anuncio;
  variacao: Variacao | null;
  sku: string | null;
  vinculos: Vinculo[];
}

@Component({
  selector: 'app-vinculos',
  imports: [FormsModule],
  templateUrl: './vinculos.html',
  styleUrl: './vinculos.css',
})
export class VinculosComponent implements OnInit {
  private readonly supabase = inject(AUTH_CLIENT);
  readonly contas = signal<Conta[]>([]);
  readonly conta = signal('');
  readonly anuncios = signal<Anuncio[]>([]);
  readonly produtos = signal<Produto[]>([]);
  readonly filtro = signal('');
  readonly somentePendentes = signal(true);
  readonly chaveEmEdicao = signal('');
  readonly buscaProduto = signal('');
  readonly produtoSelecionado = signal('');
  readonly carregando = signal(false);
  readonly salvando = signal(false);
  readonly erro = signal('');
  readonly sucesso = signal('');

  readonly produtosPorId = computed(() => new Map(this.produtos().map(produto => [produto.id, produto])));
  readonly linhas = computed(() => this.anuncios().flatMap(anuncio => {
    const variacoes = new Map(anuncio.variacoes_marketplace.map(variacao => [variacao.id, variacao]));
    for (const vinculo of anuncio.anuncio_skus) {
      const id = vinculo.variacao_id_meli;
      if (id && !variacoes.has(id)) variacoes.set(id, { id, sku: null, nome: null });
    }
    const alvos = variacoes.size ? [...variacoes.values()] : [null];
    return alvos.map((variacao): Linha => ({
      chave: `${anuncio.id}:${variacao?.id ?? ''}`,
      anuncio,
      variacao,
      sku: variacao ? variacao.sku : anuncio.sku_marketplace,
      vinculos: anuncio.anuncio_skus.filter(vinculo => vinculo.variacao_id_meli === (variacao?.id ?? null)),
    }));
  }));
  readonly pendentes = computed(() => this.linhas().filter(linha => linha.vinculos.length !== 1).length);
  readonly linhasVisiveis = computed(() => {
    const termo = this.filtro().trim().toLocaleLowerCase('pt-BR');
    return this.linhas().filter(linha => (!this.somentePendentes() || linha.vinculos.length !== 1)
      && [linha.anuncio.titulo_anuncio, linha.anuncio.item_id_meli, linha.sku, linha.variacao?.nome]
        .some(texto => texto?.toLocaleLowerCase('pt-BR').includes(termo)));
  });
  readonly opcoesProduto = computed(() => {
    const termo = this.buscaProduto().trim().toLocaleLowerCase('pt-BR');
    const encontrados = this.produtos().filter(produto => [produto.sku_interno, produto.nome_produto]
      .some(texto => texto.toLocaleLowerCase('pt-BR').includes(termo))).slice(0, 30);
    const selecionado = this.produtosPorId().get(this.produtoSelecionado());
    return selecionado && !encontrados.some(produto => produto.id === selecionado.id)
      ? [selecionado, ...encontrados] : encontrados;
  });

  async ngOnInit(): Promise<void> {
    this.carregando.set(true);
    try {
      const [contas, produtos] = await Promise.all([
        this.supabase.from('meli_contas').select('id,nome_conta,seller_id_meli')
          .order('nome_conta').order('id').returns<Conta[]>(),
        this.lerProdutos(),
      ]);
      if (contas.error) throw contas.error;
      this.contas.set(contas.data ?? []);
      this.produtos.set(produtos);
      if (contas.data?.length === 1) await this.selecionarConta(contas.data[0].id);
    } catch {
      this.erro.set('Falha ao carregar as lojas ou os produtos internos.');
    } finally {
      this.carregando.set(false);
    }
  }

  private async lerProdutos(): Promise<Produto[]> {
    const produtos: Produto[] = [];
    for (let inicio = 0; ; inicio += 500) {
      const { data, error } = await this.supabase.from('produtos_internos')
        .select('id,sku_interno,nome_produto,tipo').order('sku_interno').order('id')
        .range(inicio, inicio + 499).returns<Produto[]>();
      if (error) throw error;
      produtos.push(...(data ?? []));
      if (!data || data.length < 500) return produtos;
    }
  }

  async selecionarConta(id: string): Promise<void> {
    this.conta.set(id);
    this.anuncios.set([]);
    this.chaveEmEdicao.set('');
    this.erro.set('');
    this.sucesso.set('');
    if (!id) return;
    this.carregando.set(true);
    try {
      const anuncios: Anuncio[] = [];
      for (let inicio = 0; ; inicio += 500) {
        const { data, error } = await this.supabase.from('meli_anuncios')
          .select('id,item_id_meli,titulo_anuncio,sku_marketplace,variacoes_marketplace,anuncio_skus(id,variacao_id_meli,produto_interno_id)')
          .eq('conta_id', id).order('titulo_anuncio').order('id')
          .range(inicio, inicio + 499).returns<Anuncio[]>();
        if (error) throw error;
        anuncios.push(...(data ?? []));
        if (!data || data.length < 500) break;
      }
      this.anuncios.set(anuncios);
    } catch {
      this.erro.set('Falha ao carregar os anúncios desta loja.');
    } finally {
      this.carregando.set(false);
    }
  }

  editar(linha: Linha): void {
    this.erro.set('');
    this.sucesso.set('');
    this.chaveEmEdicao.set(linha.chave);
    this.buscaProduto.set('');
    this.produtoSelecionado.set(linha.vinculos[0]?.produto_interno_id ?? '');
  }

  async salvar(linha: Linha): Promise<void> {
    const produto = this.produtoSelecionado();
    if (!produto || this.salvando() || linha.vinculos.length > 1) return;
    this.salvando.set(true);
    this.erro.set('');
    this.sucesso.set('');
    const anterior = linha.vinculos[0];
    const variacao = linha.variacao?.id ?? null;
    try {
      const { data, error } = await this.supabase.rpc('salvar_vinculo_meli', {
        p_anuncio_id: linha.anuncio.id,
        p_variacao_id: variacao,
        p_produto_id: produto,
        p_vinculo_esperado: anterior?.id ?? null,
        p_produto_esperado: anterior?.produto_interno_id ?? null,
      });
      if (error) throw error;
      this.anuncios.update(anuncios => anuncios.map(anuncio => anuncio.id === linha.anuncio.id ? {
        ...anuncio,
        anuncio_skus: [
          ...anuncio.anuncio_skus.filter(vinculo => vinculo.id !== anterior?.id),
          { id: data, variacao_id_meli: variacao, produto_interno_id: produto },
        ],
      } : anuncio));
      this.chaveEmEdicao.set('');
      this.sucesso.set('Vínculo salvo.');
    } catch (erro) {
      const mensagem = (erro as { code?: string; message?: string })?.code === 'P0001'
        ? (erro as { message: string }).message : 'Falha ao salvar o vínculo.';
      this.erro.set(mensagem);
    } finally {
      this.salvando.set(false);
    }
  }
}
