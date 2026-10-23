import { Component, ElementRef, EventEmitter, inject, Input, OnDestroy, OnInit, AfterViewInit, Output, signal, ViewChild } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { DetalhePedidoFinanceiro, formatarDataVenda, formatarMargem, formatarMoeda, qualidadeTexto, resultadoTexto, statusTexto } from '../../../../models/pedido-financeiro';
import { FinanceiroService } from '../../../../services/financeiro.service';
import { ProdutoImagemComponent } from '../../../../shared/produto-imagem/produto-imagem';

@Component({
  selector: 'app-pedido-detalhes',
  standalone: true,
  imports: [ProdutoImagemComponent],
  templateUrl: './pedido-detalhes.html',
  styleUrl: './pedido-detalhes.css',
})
export class PedidoDetalhesComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input({ required: true }) pedidoId!: string;
  @Output() fechar = new EventEmitter<void>();
  @ViewChild('dialogo', { static: true }) dialogo!: ElementRef<HTMLDialogElement>;
  private readonly financeiro = inject(FinanceiroService);
  private readonly documento = inject(DOCUMENT);
  private requisicao?: AbortController;
  private origem: HTMLElement | null = null;
  private rolagem: { elemento: HTMLElement; overflow: string }[] = [];
  detalhe = signal<DetalhePedidoFinanceiro | null>(null);
  carregando = signal(true);
  erro = signal('');
  moeda = formatarMoeda;
  margem = formatarMargem;
  dataVenda = formatarDataVenda;
  qualidade = qualidadeTexto;
  resultado = resultadoTexto;
  status = statusTexto;

  ngOnInit() { void this.carregar(); }

  ngAfterViewInit() {
    this.origem = this.documento.activeElement as HTMLElement | null;
    const pagina = this.documento.querySelector<HTMLElement>('.page-content');
    for (const elemento of [this.documento.body, pagina]) {
      if (!elemento) continue;
      this.rolagem.push({ elemento, overflow: elemento.style.overflow });
      elemento.style.overflow = 'hidden';
    }
    this.dialogo.nativeElement.showModal();
  }

  async carregar() {
    this.requisicao?.abort();
    const requisicao = new AbortController();
    this.requisicao = requisicao;
    this.carregando.set(true);
    this.erro.set('');
    try {
      const detalhe = await this.financeiro.detalhe(this.pedidoId, requisicao.signal);
      if (!requisicao.signal.aborted) this.detalhe.set(detalhe);
    } catch (erro) {
      if (!requisicao.signal.aborted) this.erro.set(erro instanceof Error ? erro.message : 'Erro ao carregar pedido.');
    } finally {
      if (!requisicao.signal.aborted) this.carregando.set(false);
    }
  }

  cancelar(evento: Event) {
    evento.preventDefault();
    this.fechar.emit();
  }

  ngOnDestroy() {
    this.requisicao?.abort();
    this.dialogo.nativeElement.close();
    for (const { elemento, overflow } of this.rolagem) elemento.style.overflow = overflow;
    if (this.origem?.isConnected) this.origem.focus({ preventScroll: true });
  }
}
