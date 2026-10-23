import { DetalhePedidoFinanceiro, ItemPedidoFinanceiro, ResumoFinanceiro } from './pedido-financeiro';

type Dinheiro = number | string | null;
export interface ContaFinanceira { id: string; nome_conta: string; }
export interface CabecalhoPedido {
  id: string; order_id_meli: string; conta_id: string; data_venda: string;
  status_pedido: string; valor_total: Dinheiro; taxa_ml: Dinheiro; custo_frete: Dinheiro;
}
export interface LinhaPedido { id: string; pedido_id: string; anuncio_sku_id: string; quantidade_vendida: number; }
export interface VinculoPedido { id: string; anuncio_id: string; produto_interno_id: string; variacao_id_meli: string | null; }
export interface AnuncioPedido { id: string; item_id_meli: string; titulo_anuncio: string; foto_url: string | null; }
export interface ProdutoPedido { id: string; sku_interno: string; nome_produto: string; tipo: string; foto_url: string | null; custo_unitario: Dinheiro; }
export interface LinhaRelacionada extends LinhaPedido { vinculo: VinculoPedido | null; anuncio: AnuncioPedido | null; produto: ProdutoPedido | null; }
export interface PedidoCalculado extends DetalhePedidoFinanceiro {
  valores: { receita: number | null; custo: number | null; taxa: number | null; frete: number | null; lucro: number | null };
}

function centavos(valor: Dinheiro | undefined): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const partes = String(valor).match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!partes) return null;
  const decimais = (partes[3] || '').padEnd(3, '0');
  let total = BigInt(partes[2]) * 100n + BigInt(decimais.slice(0, 2));
  if (Number(decimais[2]) >= 5) total++;
  if (partes[1]) total = -total;
  const numero = Number(total);
  return Number.isSafeInteger(numero) ? numero : null;
}

export function somarCentavos(valores: (number | null)[]): number | null {
  let soma = 0n;
  for (const valor of valores) {
    if (valor === null || !Number.isSafeInteger(valor)) return null;
    soma += BigInt(valor);
  }
  const total = Number(soma);
  return Number.isSafeInteger(total) ? total : null;
}
const reais = (valor: number | null): number | null => valor === null ? null : valor / 100;

export function calcularPedido(pedido: CabecalhoPedido, linhas: LinhaRelacionada[], conta: string): PedidoCalculado {
  const pendencias = [
    'Custo atual do cadastro; não existe custo histórico congelado nesta venda.',
    'Taxas e frete são os valores importados, ainda sem reconciliação financeira.',
    'Descontos, estornos, impostos e despesas adicionais não estão detalhados nesta base.',
    'Não há identificação de envio para conferir ou ratear fretes compartilhados.',
  ];
  const itens = linhas.map(linha => {
    const { produto, anuncio, vinculo } = linha;
    const quantidade = Number(linha.quantidade_vendida);
    const quantidadeValida = Number.isSafeInteger(quantidade) && quantidade > 0;
    const custo = centavos(produto?.custo_unitario);
    const custoValido = custo !== null && custo > 0 ? custo : null;
    const total = custoValido !== null && quantidadeValida && Number.isSafeInteger(custoValido * quantidade)
      ? custoValido * quantidade : null;
    const item: ItemPedidoFinanceiro = {
      id: linha.id, produto_id: produto?.id || null,
      titulo: anuncio?.titulo_anuncio || produto?.nome_produto || 'Produto não identificado',
      foto_url: anuncio?.foto_url || produto?.foto_url || null,
      origem_imagem: anuncio?.foto_url ? 'Anúncio atual' : produto?.foto_url ? 'Cadastro atual' : null,
      sku: produto?.sku_interno || null, tipo: produto?.tipo || null,
      anuncio_id: anuncio?.item_id_meli || null, variacao_id: vinculo?.variacao_id_meli || null,
      quantidade: quantidadeValida ? quantidade : null, preco_unitario: null, total_venda: null,
      custo_unitario: reais(custoValido), custo_total: reais(total),
      origem_custo: produto ? 'Custo atual do cadastro' : 'Sem vínculo com produto',
    };
    return { item, centavos: total };
  });
  const receita = centavos(pedido.valor_total);
  const taxa = centavos(pedido.taxa_ml);
  const frete = centavos(pedido.custo_frete);
  const custo = itens.length ? somarCentavos(itens.map(item => item.centavos)) : null;
  if (!itens.length) pendencias.push('Pedido sem itens importados.');
  if (itens.some(item => item.centavos === null)) pendencias.push('Há itens sem vínculo, quantidade válida ou custo maior que zero validável.');
  if (receita === null || receita < 0) pendencias.push('Receita ausente ou inválida.');
  if (taxa === null || taxa < 0) pendencias.push('Taxa ausente ou inválida.');
  if (frete === null || frete < 0) pendencias.push('Frete ausente ou inválido.');
  if (taxa === 0 || frete === 0) pendencias.push('Taxa ou frete zerado pode representar ausência de apuração; o valor não está confirmado.');
  if (pedido.status_pedido !== 'paid') pendencias.push('Pedido não pago; não entra nos indicadores de vendas pagas.');
  const lucro = pedido.status_pedido === 'paid' && custo !== null && receita !== null && receita >= 0
    && taxa !== null && taxa > 0 && frete !== null && frete > 0
    ? somarCentavos([receita, -custo, -taxa, -frete]) : null;
  return {
    id: pedido.id, numero: pedido.order_id_meli, conta_id: pedido.conta_id, conta,
    data_venda: pedido.data_venda, status: pedido.status_pedido,
    titulo: itens[0]?.item.titulo || 'Produto não identificado',
    foto_url: itens[0]?.item.foto_url || null, sku: itens[0]?.item.sku || null,
    quantidade: itens.length ? somarCentavos(itens.map(({ item }) => item.quantidade)) : null,
    numero_itens: itens.length, receita: reais(receita), custo: reais(custo), taxa: reais(taxa), frete: reais(frete),
    lucro: reais(lucro), margem: lucro !== null && receita !== null && receita > 0 ? lucro / receita * 100 : null,
    qualidade: lucro === null ? 'incompleto' : 'estimado', pendencias,
    valor_apos_taxas_frete: receita !== null && receita >= 0 && taxa !== null && taxa >= 0 && frete !== null && frete >= 0
      ? reais(somarCentavos([receita, -taxa, -frete])) : null,
    atualizado_em: null, itens: itens.map(({ item }) => item),
    valores: { receita, custo, taxa, frete, lucro },
  };
}

export function resumirPedidos(pedidos: PedidoCalculado[]): ResumoFinanceiro {
  const pagos = pedidos.filter(pedido => pedido.status === 'paid');
  const calculaveis = pagos.filter(pedido => pedido.valores.lucro !== null);
  const total = (campo: keyof PedidoCalculado['valores']) => somarCentavos(pagos.map(pedido => pedido.valores[campo]));
  const receita = total('receita');
  const receitaCalculavel = somarCentavos(calculaveis.map(pedido => pedido.valores.receita));
  const lucroEstimado = somarCentavos(calculaveis.map(pedido => pedido.valores.lucro));
  const ranking = new Map<string, { titulo: string; foto_url: string | null; total_vendido: number }>();
  for (const pedido of pagos) for (const item of pedido.itens) {
    if (!item.produto_id || item.quantidade === null) continue;
    const anterior = ranking.get(item.produto_id);
    ranking.set(item.produto_id, {
      titulo: anterior?.titulo || item.titulo, foto_url: anterior?.foto_url || item.foto_url,
      total_vendido: (anterior?.total_vendido || 0) + item.quantidade,
    });
  }
  const maisVendido = [...ranking.entries()].sort((a, b) => b[1].total_vendido - a[1].total_vendido || a[0].localeCompare(b[0]))[0]?.[1] || null;
  return {
    faturamento_bruto: reais(receita), numero_vendas: pagos.length,
    custo_total: reais(total('custo')), taxa_ml_total: reais(total('taxa')), frete_total: reais(total('frete')),
    lucro_estimado: reais(lucroEstimado), receita_calculavel: reais(receitaCalculavel),
    margem_estimada: receitaCalculavel !== null && receitaCalculavel > 0 && lucroEstimado !== null
      ? lucroEstimado / receitaCalculavel * 100 : null,
    pedidos_estimados: calculaveis.length, pedidos_incompletos: pagos.length - calculaveis.length,
    ticket_medio: receita !== null && pagos.length ? reais(Math.round(receita / pagos.length)) : pagos.length ? null : 0,
    item_mais_vendido: maisVendido,
  };
}
