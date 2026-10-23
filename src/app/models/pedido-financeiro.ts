export type QualidadeFinanceira = 'estimado' | 'incompleto';

export interface FiltrosFinanceiros {
  inicio: string;
  fim: string;
  conta: string;
}

export interface PedidoFinanceiro {
  id: string;
  numero: string;
  conta_id: string;
  conta: string;
  data_venda: string;
  status: string;
  titulo: string;
  foto_url: string | null;
  sku: string | null;
  quantidade: number | null;
  numero_itens: number;
  receita: number | null;
  custo: number | null;
  taxa: number | null;
  frete: number | null;
  lucro: number | null;
  margem: number | null;
  qualidade: QualidadeFinanceira;
  pendencias: string[];
}

export interface ItemPedidoFinanceiro {
  id: string;
  produto_id: string | null;
  titulo: string;
  foto_url: string | null;
  origem_imagem: string | null;
  sku: string | null;
  tipo: string | null;
  anuncio_id: string | null;
  variacao_id: string | null;
  quantidade: number | null;
  preco_unitario: number | null;
  total_venda: number | null;
  custo_unitario: number | null;
  custo_total: number | null;
  origem_custo: string;
}

export interface DetalhePedidoFinanceiro extends PedidoFinanceiro {
  itens: ItemPedidoFinanceiro[];
  valor_apos_taxas_frete: number | null;
  atualizado_em: string | null;
}

export interface PaginaPedidosFinanceiros {
  pedidos: PedidoFinanceiro[];
  total: number;
  pagina: number;
  tamanho_pagina: number;
  total_paginas: number;
  contas: { id: string; nome_conta: string }[];
}

export interface ResumoFinanceiro {
  faturamento_bruto: number | null;
  numero_vendas: number;
  custo_total: number | null;
  taxa_ml_total: number | null;
  frete_total: number | null;
  lucro_estimado: number | null;
  receita_calculavel: number | null;
  margem_estimada: number | null;
  pedidos_estimados: number;
  pedidos_incompletos: number;
  ticket_medio: number | null;
  item_mais_vendido: { titulo: string; foto_url: string | null; total_vendido: number } | null;
}

const moedaBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const porcentagemBR = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBR = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short',
});

export const formatarMoeda = (valor: number | null): string => valor === null ? 'Não disponível' : moedaBRL.format(valor);
export const formatarMargem = (valor: number | null): string => valor === null ? '—' : `${porcentagemBR.format(valor)}%`;
export const formatarDataVenda = (valor: string): string => dataBR.format(new Date(valor));
export const qualidadeTexto = (qualidade: QualidadeFinanceira): string => qualidade === 'estimado' ? 'Estimado' : 'Cálculo incompleto';
export function resultadoTexto(lucro: number | null): string {
  if (lucro === null) return 'Cálculo incompleto';
  return lucro > 0 ? 'Lucro' : lucro < 0 ? 'Prejuízo' : 'Resultado zero';
}
export function statusTexto(status: string): string {
  const nomes: Record<string, string> = {
    paid: 'Pago', cancelled: 'Cancelado', confirmed: 'Confirmado', payment_required: 'Aguardando pagamento',
    payment_in_process: 'Pagamento em processamento', partially_paid: 'Parcialmente pago', invalid: 'Inválido',
  };
  return nomes[status] || status;
}
