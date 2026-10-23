import { Component, EventEmitter, inject, Input, OnChanges, OnDestroy, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FiltrosFinanceiros, formatarDataVenda, formatarMargem, formatarMoeda, PaginaPedidosFinanceiros, qualidadeTexto, resultadoTexto, statusTexto } from '../../../../models/pedido-financeiro';
import { FinanceiroService } from '../../../../services/financeiro.service';
import { PedidoDetalhesComponent } from '../pedido-detalhes/pedido-detalhes';
import { ProdutoImagemComponent } from '../../../../shared/produto-imagem/produto-imagem';

@Component({
  selector: 'app-pedidos-lista', standalone: true,
  imports: [FormsModule, PedidoDetalhesComponent, ProdutoImagemComponent],
  templateUrl: './pedidos-lista.html', styleUrl: './pedidos-lista.css',
})
export class PedidosListaComponent implements OnChanges, OnDestroy {
  @Input() filtros: FiltrosFinanceiros | null = null;
  @Output() contaAlterada = new EventEmitter<string>();
  private readonly financeiro = inject(FinanceiroService);
  private requisicao?: AbortController;
  private filtrosLista = { status: 'paid', busca: '' };
  pagina = signal<PaginaPedidosFinanceiros | null>(null);
  carregando = signal(false);
  erro = signal('');
  busca = signal('');
  statusSelecionado = signal('paid');
  pedidoSelecionado = signal<string | null>(null);
  moeda = formatarMoeda;
  margem = formatarMargem;
  dataVenda = formatarDataVenda;
  qualidade = qualidadeTexto;
  resultado = resultadoTexto;
  status = statusTexto;

  ngOnChanges() {
    this.pedidoSelecionado.set(null);
    this.pagina.set(null);
    void this.carregar(1);
  }

  aplicarBusca() {
    this.filtrosLista = { status: this.statusSelecionado(), busca: this.busca().trim() };
    void this.carregar(1);
  }

  async carregar(numero = this.pagina()?.pagina || 1) {
    if (!this.filtros) return;
    this.requisicao?.abort();
    const requisicao = new AbortController();
    this.requisicao = requisicao;
    this.carregando.set(true);
    this.erro.set('');
    try {
      const pagina = await this.financeiro.pedidos(this.filtros, this.filtrosLista.status, this.filtrosLista.busca, numero, requisicao.signal);
      if (!requisicao.signal.aborted) this.pagina.set(pagina);
    } catch (erro) {
      if (!requisicao.signal.aborted) this.erro.set(erro instanceof Error ? erro.message : 'Erro ao carregar pedidos.');
    } finally {
      if (!requisicao.signal.aborted) this.carregando.set(false);
    }
  }

  ngOnDestroy() { this.requisicao?.abort(); }
}
