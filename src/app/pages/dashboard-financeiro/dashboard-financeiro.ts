import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FiltrosFinanceiros, formatarMargem, formatarMoeda, ResumoFinanceiro } from '../../models/pedido-financeiro';
import { FinanceiroService } from '../../services/financeiro.service';
import { PedidosListaComponent } from './components/pedidos-lista/pedidos-lista';

@Component({
  selector: 'app-dashboard-financeiro', standalone: true,
  imports: [FormsModule, PedidosListaComponent],
  templateUrl: './dashboard-financeiro.html', styleUrl: './dashboard-financeiro.css',
})
export class DashboardFinanceiroComponent implements OnInit, OnDestroy {
  private readonly financeiro = inject(FinanceiroService);
  private requisicao?: AbortController;
  isLoading = signal(false);
  errorMessage = signal('');
  dados = signal<ResumoFinanceiro | null>(null);
  filtrosAplicados = signal<FiltrosFinanceiros | null>(null);
  periodoInicio = signal('');
  periodoFim = signal('');
  moeda = formatarMoeda;
  margem = formatarMargem;

  ngOnInit() {
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const hoje = ['year', 'month', 'day'].map(tipo => partes.find(parte => parte.type === tipo)!.value).join('-');
    this.periodoInicio.set(`${hoje.slice(0, 7)}-01`);
    this.periodoFim.set(hoje);
    this.aplicarFiltro();
  }

  aplicarFiltro() {
    if (!this.periodoInicio() || !this.periodoFim() || this.periodoInicio() > this.periodoFim()) {
      this.errorMessage.set('Selecione um período válido: a data inicial não pode ser posterior à final.');
      return;
    }
    this.filtrosAplicados.set({
      inicio: this.periodoInicio(), fim: this.periodoFim(), conta: this.filtrosAplicados()?.conta || '',
    });
    void this.carregarDados();
  }

  alterarConta(conta: string) {
    const filtros = this.filtrosAplicados();
    if (!filtros || conta === filtros.conta) return;
    this.filtrosAplicados.set({ ...filtros, conta });
    void this.carregarDados();
  }

  async carregarDados() {
    const filtros = this.filtrosAplicados();
    if (!filtros) return;
    this.requisicao?.abort();
    const requisicao = new AbortController();
    this.requisicao = requisicao;
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.dados.set(null);
    try {
      const resumo = await this.financeiro.resumo(filtros, requisicao.signal);
      if (!requisicao.signal.aborted) this.dados.set(resumo);
    } catch (erro) {
      if (!requisicao.signal.aborted) this.errorMessage.set(erro instanceof Error ? erro.message : 'Erro ao carregar dados financeiros.');
    } finally {
      if (!requisicao.signal.aborted) this.isLoading.set(false);
    }
  }

  ngOnDestroy() { this.requisicao?.abort(); }
}
