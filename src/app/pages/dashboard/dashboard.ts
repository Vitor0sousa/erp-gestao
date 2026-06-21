import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment.development';

interface ProdutoInterno {
  id: string;
  sku_interno: string;
  nome_produto: string;
  tipo: 'SIMPLES' | 'KIT';
  estoque_fisico: number;
  estoque_calculado?: number;
}

interface ComposicaoItem {
  sku_simples_id: string;
  nome_produto: string;
  quantidade_necessaria: number;
  estoque_atual: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class DashboardComponent implements OnInit {
  produtos = signal<ProdutoInterno[]>([]);
  isLoading = signal(true);
  errorMessage = signal('');

  produtosSimples = computed(() => this.produtos().filter(p => p.tipo === 'SIMPLES'));

  isModalOpen = signal(false);
  isSaving = signal(false);
  modalMode = signal<'NOVO' | 'EDITAR'>('NOVO');

  formId = signal('');
  formSku = signal('');
  formNome = signal('');
  formTipo = signal<'SIMPLES' | 'KIT'>('SIMPLES');
  formEstoque = signal<number>(0);

  composicaoAtual = signal<ComposicaoItem[]>([]);
  buscaItem = signal(''); 
  produtoSelecionadoParaKit = signal<ProdutoInterno | null>(null);
  itemAdicionarQtd = signal<number>(1);

  resultadosBusca = computed(() => {
    const termo = this.buscaItem().toLowerCase().trim();
    if (!termo) return [];
    
    return this.produtosSimples().filter(p => 
      p.sku_interno.toLowerCase().includes(termo) || 
      p.nome_produto.toLowerCase().includes(termo)
    ).slice(0, 8);
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
    this.isLoading.set(true);
    try {
      const { data: prods, error: errProds } = await this.supabase
        .from('produtos_internos')
        .select('*')
        .order('nome_produto', { ascending: true });

      if (errProds) throw errProds;

      const { data: composicoes, error: errComp } = await this.supabase
        .from('composicao_kits')
        .select('*');

      if (errComp) throw errComp;

      const prodsFinal = (prods || []).map(p => {
        if (p.tipo === 'KIT') {
          const itensDesteKit = (composicoes || []).filter(c => c.sku_kit_id === p.id);
          
          if (itensDesteKit.length === 0) {
            p.estoque_calculado = 0;
          } else {
            let maxKitsPossiveis = Infinity;
            
            itensDesteKit.forEach(itemDaReceita => {
              const prodSimples = prods.find(ps => ps.id === itemDaReceita.sku_simples_id);
              const estoqueAtual = prodSimples ? prodSimples.estoque_fisico : 0;
              const quantosKitsDaParaFazer = Math.floor(estoqueAtual / itemDaReceita.quantidade_necessaria);
              
              if (quantosKitsDaParaFazer < maxKitsPossiveis) {
                maxKitsPossiveis = quantosKitsDaParaFazer;
              }
            });
            
            p.estoque_calculado = maxKitsPossiveis === Infinity ? 0 : maxKitsPossiveis;
          }
        }
        return p;
      });

      this.produtos.set(prodsFinal);
    } catch (error) {
      this.errorMessage.set('Erro ao carregar estoque.');
      console.error(error);
    } finally {
      this.isLoading.set(false);
    }
  }

  abrirModalNovo() {
    this.modalMode.set('NOVO');
    this.formId.set('');
    this.formSku.set('');
    this.formNome.set('');
    this.formTipo.set('SIMPLES');
    this.formEstoque.set(0);
    
    this.resetarBuscaComposicao();
    this.composicaoAtual.set([]);
    
    this.isModalOpen.set(true);
  }

  async abrirModalEditar(produto: ProdutoInterno) {
    this.modalMode.set('EDITAR');
    this.formId.set(produto.id);
    this.formSku.set(produto.sku_interno || '');
    this.formNome.set(produto.nome_produto);
    this.formTipo.set(produto.tipo || 'SIMPLES');
    this.formEstoque.set(produto.estoque_fisico || 0);
    
    this.resetarBuscaComposicao();
    this.composicaoAtual.set([]);

    if (produto.tipo === 'KIT') {
      const { data, error } = await this.supabase
        .from('composicao_kits')
        .select('sku_simples_id, quantidade_necessaria')
        .eq('sku_kit_id', produto.id);

      if (!error && data) {
        const itensCarregados: ComposicaoItem[] = data.map((d: any) => {
          const prodLocal = this.produtosSimples().find(p => p.id === d.sku_simples_id);
          return {
            sku_simples_id: d.sku_simples_id,
            quantidade_necessaria: d.quantidade_necessaria,
            nome_produto: prodLocal ? prodLocal.nome_produto : 'Produto não encontrado',
            estoque_atual: prodLocal ? prodLocal.estoque_fisico : 0
          };
        });
        this.composicaoAtual.set(itensCarregados);
      }
    }

    this.isModalOpen.set(true);
  }

  fecharModal() {
    this.isModalOpen.set(false);
  }

  selecionarProdutoNaBusca(prod: ProdutoInterno) {
    this.produtoSelecionadoParaKit.set(prod);
    this.buscaItem.set('');
  }

  removerSelecaoDaBusca() {
    this.produtoSelecionadoParaKit.set(null);
  }

  resetarBuscaComposicao() {
    this.buscaItem.set('');
    this.produtoSelecionadoParaKit.set(null);
    this.itemAdicionarQtd.set(1);
  }

  adicionarItemAoKit() {
    const prod = this.produtoSelecionadoParaKit();
    const qtd = this.itemAdicionarQtd();
    
    if (!prod || qtd <= 0) return;

    const lista = [...this.composicaoAtual()];
    const indexExistente = lista.findIndex(c => c.sku_simples_id === prod.id);

    if (indexExistente >= 0) {
      lista[indexExistente].quantidade_necessaria += qtd;
    } else {
      lista.push({
        sku_simples_id: prod.id,
        nome_produto: prod.nome_produto,
        quantidade_necessaria: qtd,
        estoque_atual: prod.estoque_fisico
      });
    }

    this.composicaoAtual.set(lista);
    this.resetarBuscaComposicao();
  }

  removerItemDoKit(index: number) {
    const lista = [...this.composicaoAtual()];
    lista.splice(index, 1);
    this.composicaoAtual.set(lista);
  }

  async salvarProduto() {
    if (!this.formNome() || !this.formSku()) {
      alert("Por favor, preencha o Nome e o SKU.");
      return;
    }

    if (this.formTipo() === 'KIT' && this.composicaoAtual().length === 0) {
      alert("Um KIT precisa ter pelo menos um produto na sua composição!");
      return;
    }

    this.isSaving.set(true);
    let produtoIdParaKit = this.formId();

    let estoqueCalculadoParaSalvar = this.formEstoque();
    
    if (this.formTipo() === 'KIT') {
      let maxKits = Infinity;
      this.composicaoAtual().forEach(item => {
        const possiveis = Math.floor(item.estoque_atual / item.quantidade_necessaria);
        if (possiveis < maxKits) maxKits = possiveis;
      });
      estoqueCalculadoParaSalvar = maxKits === Infinity ? 0 : maxKits;
    }

    const dadosParaSalvar = {
      sku_interno: this.formSku(),
      nome_produto: this.formNome(),
      tipo: this.formTipo(),
      estoque_fisico: estoqueCalculadoParaSalvar 
    };

    try {
      if (this.modalMode() === 'NOVO') {
        const { data, error } = await this.supabase
          .from('produtos_internos')
          .insert([dadosParaSalvar])
          .select('id')
          .single();
          
        if (error) throw error;
        produtoIdParaKit = data.id; 
      } else {
        const { error } = await this.supabase
          .from('produtos_internos')
          .update(dadosParaSalvar)
          .eq('id', produtoIdParaKit);

        if (error) throw error;
      }

      if (this.formTipo() === 'KIT') {
        await this.supabase.from('composicao_kits').delete().eq('sku_kit_id', produtoIdParaKit);

        const insertComposicao = this.composicaoAtual().map(item => ({
          sku_kit_id: produtoIdParaKit,
          sku_simples_id: item.sku_simples_id,
          quantidade_necessaria: item.quantidade_necessaria
        }));

        if (insertComposicao.length > 0) {
          const { error: compError } = await this.supabase.from('composicao_kits').insert(insertComposicao);
          if (compError) throw compError;
        }
      } else if (this.modalMode() === 'EDITAR' && this.formTipo() === 'SIMPLES') {
        await this.supabase.from('composicao_kits').delete().eq('sku_kit_id', produtoIdParaKit);
      }

      this.fecharModal();
      this.carregarProdutos();
    } catch (error: any) {
      console.error(error);
      alert('Erro ao salvar: ' + error.message);
    } finally {
      this.isSaving.set(false);
    }
  }

  async fazerLogout() {
    await this.supabase.auth.signOut();
    this.router.navigate(['/login']);
  }
}
