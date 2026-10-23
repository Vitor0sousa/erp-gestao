import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { DetalhePedidoFinanceiro, FiltrosFinanceiros, PaginaPedidosFinanceiros, ResumoFinanceiro } from '../models/pedido-financeiro';
import {
  AnuncioPedido, CabecalhoPedido, calcularPedido, ContaFinanceira, LinhaPedido, LinhaRelacionada,
  PedidoCalculado, ProdutoPedido, resumirPedidos, VinculoPedido,
} from '../models/calculo-financeiro';

interface ResultadoConsulta<T> { data: T[] | null; error: { message: string } | null; }
const CAMPOS_PEDIDO = 'id,order_id_meli,conta_id,data_venda,status_pedido,valor_total,taxa_ml,custo_frete';
const TAMANHO_LOTE = 250;
const LIMITE_REGISTROS = 20000;

@Injectable({ providedIn: 'root' })
export class FinanceiroService {
  private supabase: SupabaseClient;

  constructor() {
    // Mesmo cliente e configuração utilizados nas páginas de produtos e anúncios.
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseKey);
  }

  async resumo(filtros: FiltrosFinanceiros, signal: AbortSignal): Promise<ResumoFinanceiro> {
    const { pedidos } = await this.carregarPeriodo(filtros, signal, true);
    return resumirPedidos(pedidos);
  }

  async pedidos(filtros: FiltrosFinanceiros, status: string, busca: string, pagina: number, signal: AbortSignal): Promise<PaginaPedidosFinanceiros> {
    const dados = await this.carregarPeriodo(filtros, signal);
    const termo = busca.trim().toLowerCase();
    const pedidos = dados.pedidos.filter(pedido => {
      if (status !== 'all' && pedido.status !== status) return false;
      return !termo || [pedido.numero, ...pedido.itens.flatMap(item => [item.titulo, item.sku])]
        .some(valor => valor?.toLowerCase().includes(termo));
    });
    const totalPaginas = Math.max(1, Math.ceil(pedidos.length / 20));
    const paginaAtual = Math.min(Math.max(1, pagina), totalPaginas);
    return {
      pedidos: pedidos.slice((paginaAtual - 1) * 20, paginaAtual * 20).map(({ valores, itens, ...pedido }) => pedido),
      total: pedidos.length, pagina: paginaAtual, tamanho_pagina: 20, total_paginas: totalPaginas, contas: dados.contas,
    };
  }

  async detalhe(id: string, signal: AbortSignal): Promise<DetalhePedidoFinanceiro> {
    const { data, error } = await this.supabase
      .from('pedidos').select(CAMPOS_PEDIDO).eq('id', id).abortSignal(signal).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Pedido não encontrado ou sem permissão de acesso.');
    const cabecalho = data as CabecalhoPedido;
    const [itens, contas] = await Promise.all([
      this.carregarItens([id], signal),
      this.lerPorIds<ContaFinanceira>('meli_contas', 'id,nome_conta', 'id', [cabecalho.conta_id], signal),
    ]);
    const { valores, ...pedido } = calcularPedido(cabecalho, itens, contas[0]?.nome_conta || 'Conta não identificada');
    return pedido;
  }

  private async carregarPeriodo(filtros: FiltrosFinanceiros, signal: AbortSignal, apenasPagos = false) {
    const { inicio, fim } = this.intervalo(filtros);
    const cabecalhos = await this.lerTodos<CabecalhoPedido>((de, ate) => {
      let consulta = this.supabase.from('pedidos').select(CAMPOS_PEDIDO)
        .gte('data_venda', inicio).lt('data_venda', fim)
        .order('data_venda', { ascending: false }).order('id', { ascending: false });
      if (filtros.conta) consulta = consulta.eq('conta_id', filtros.conta);
      if (apenasPagos) consulta = consulta.eq('status_pedido', 'paid');
      return consulta.range(de, ate).abortSignal(signal).returns<CabecalhoPedido[]>();
    }, signal);
    const [itens, contas] = await Promise.all([
      this.carregarItens(cabecalhos.map(pedido => pedido.id), signal),
      this.lerTodos<ContaFinanceira>((de, ate) => this.supabase
        .from('meli_contas').select('id,nome_conta').order('nome_conta').order('id')
        .range(de, ate).abortSignal(signal).returns<ContaFinanceira[]>(), signal),
    ]);
    const nomesContas = new Map(contas.map(conta => [conta.id, conta.nome_conta]));
    const itensPorPedido = new Map<string, LinhaRelacionada[]>();
    for (const item of itens) {
      const grupo = itensPorPedido.get(item.pedido_id) || [];
      grupo.push(item);
      itensPorPedido.set(item.pedido_id, grupo);
    }
    const pedidos: PedidoCalculado[] = cabecalhos.map(pedido => calcularPedido(
      pedido, itensPorPedido.get(pedido.id) || [], nomesContas.get(pedido.conta_id) || 'Conta não identificada',
    ));
    return { pedidos, contas };
  }

  private async carregarItens(ids: string[], signal: AbortSignal): Promise<LinhaRelacionada[]> {
    // Consultas separadas como no dashboard: cada tabela usa suas colunas existentes.
    const itens = await this.lerPorIds<LinhaPedido>('itens_pedido', 'id,pedido_id,anuncio_sku_id,quantidade_vendida', 'pedido_id', ids, signal);
    const vinculos = await this.lerPorIds<VinculoPedido>(
      'anuncio_skus', 'id,anuncio_id,produto_interno_id,variacao_id_meli', 'id', itens.map(item => item.anuncio_sku_id), signal,
    );
    const [anuncios, produtos] = await Promise.all([
      this.lerPorIds<AnuncioPedido>('meli_anuncios', 'id,item_id_meli,titulo_anuncio,foto_url', 'id', vinculos.map(v => v.anuncio_id), signal),
      this.lerPorIds<ProdutoPedido>('produtos_internos', 'id,sku_interno,nome_produto,tipo,foto_url,custo_unitario', 'id', vinculos.map(v => v.produto_interno_id), signal),
    ]);
    const porVinculo = new Map(vinculos.map(vinculo => [vinculo.id, vinculo]));
    const porAnuncio = new Map(anuncios.map(anuncio => [anuncio.id, anuncio]));
    const porProduto = new Map(produtos.map(produto => [produto.id, produto]));
    return itens.sort((a, b) => a.id.localeCompare(b.id)).map(item => {
      const vinculo = porVinculo.get(item.anuncio_sku_id) || null;
      return {
        ...item, vinculo,
        anuncio: vinculo ? porAnuncio.get(vinculo.anuncio_id) || null : null,
        produto: vinculo ? porProduto.get(vinculo.produto_interno_id) || null : null,
      };
    });
  }

  private async lerPorIds<T>(tabela: string, campos: string, coluna: string, ids: string[], signal: AbortSignal): Promise<T[]> {
    const unicos = [...new Set(ids.filter(Boolean))];
    const registros: T[] = [];
    for (let i = 0; i < unicos.length; i += 100) {
      const lote = unicos.slice(i, i + 100);
      registros.push(...await this.lerTodos<T>((de, ate) => this.supabase.from(tabela)
        .select(campos).in(coluna, lote).order('id').range(de, ate).abortSignal(signal).returns<T[]>(), signal));
      if (registros.length > LIMITE_REGISTROS) throw new Error('Há muitos registros. Selecione um período menor.');
    }
    return registros;
  }

  private async lerTodos<T>(consulta: (de: number, ate: number) => PromiseLike<ResultadoConsulta<T>>, signal: AbortSignal): Promise<T[]> {
    const registros: T[] = [];
    for (let de = 0; ; de += TAMANHO_LOTE) {
      if (signal.aborted) throw new Error('Consulta cancelada.');
      const { data, error } = await consulta(de, de + TAMANHO_LOTE - 1);
      if (error) throw new Error(error.message);
      registros.push(...(data || []));
      if (registros.length > LIMITE_REGISTROS) throw new Error('Há muitos registros. Selecione um período menor.');
      if (!data || data.length < TAMANHO_LOTE) return registros;
    }
  }

  private intervalo(filtros: FiltrosFinanceiros): { inicio: string; fim: string } {
    const inicio = new Date(`${filtros.inicio}T00:00:00Z`);
    const fim = new Date(`${filtros.fim}T00:00:00Z`);
    if (Number.isNaN(inicio.valueOf()) || Number.isNaN(fim.valueOf()) || inicio > fim) throw new Error('Selecione um período válido.');
    if (fim.valueOf() - inicio.valueOf() > 366 * 86400000) throw new Error('Consulte até 367 dias por vez.');
    fim.setUTCDate(fim.getUTCDate() + 1);
    return { inicio: this.inicioDoDia(filtros.inicio), fim: this.inicioDoDia(fim.toISOString().slice(0, 10)) };
  }

  private inicioDoDia(data: string): string {
    const formatador = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const meioDia = new Date(`${data}T12:00:00Z`).valueOf() / 1000;
    let minimo = meioDia - 86400;
    let maximo = meioDia + 86400;
    while (minimo < maximo) {
      const meio = Math.floor((minimo + maximo) / 2);
      const partes = formatador.formatToParts(new Date(meio * 1000));
      const dia = ['year', 'month', 'day'].map(tipo => partes.find(parte => parte.type === tipo)!.value).join('-');
      if (dia < data) minimo = meio + 1;
      else maximo = meio;
    }
    return new Date(minimo * 1000).toISOString();
  }
}
