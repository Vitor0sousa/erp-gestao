import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

interface ItemMaisVendido {
  titulo: string;
  foto_url: string | null;
  total_vendido: number;
}

interface DashboardFinanceiroData {
  faturamento_bruto: number;
  numero_vendas: number;
  custo_total: number;
  taxa_ml_total: number;
  frete_total: number;
  lucro_liquido: number;
  ticket_medio: number;
  item_mais_vendido: ItemMaisVendido | null;
}

@Component({
  selector: 'app-dashboard-financeiro',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard-financeiro.html',
  styleUrl: './dashboard-financeiro.css'
})
export class DashboardFinanceiroComponent implements OnInit {
  isLoading = signal(false);
  errorMessage = signal('');
  dados = signal<DashboardFinanceiroData | null>(null);

  // Período livre — usuário escolhe. Pré-preenchido com o mês atual só como ponto de partida.
  periodoInicio = signal<string>('');
  periodoFim = signal<string>('');

  private supabase: SupabaseClient;

  constructor(private router: Router) {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseKey);
  }

  ngOnInit() {
    this.verificarSessao();
    this.definirPeriodoPadrao();
    this.carregarDados();
  }

  async verificarSessao() {
    const { data } = await this.supabase.auth.getSession();
    if (!data.session) this.router.navigate(['/login']);
  }

  private definirPeriodoPadrao() {
    const hoje = new Date();
    const primeiroDiaMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);

    this.periodoInicio.set(this.formatarDataInput(primeiroDiaMes));
    this.periodoFim.set(this.formatarDataInput(hoje));
  }

  private formatarDataInput(data: Date): string {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }

  async carregarDados() {
    if (!this.periodoInicio() || !this.periodoFim()) {
      this.errorMessage.set('Selecione o período (data inicial e final).');
      return;
    }

    if (this.periodoInicio() > this.periodoFim()) {
      this.errorMessage.set('A data inicial não pode ser depois da data final.');
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set('');

    try {
      const { data, error } = await this.supabase.rpc('obter_dashboard_financeiro', {
        data_inicio: this.periodoInicio(),
        data_fim: this.periodoFim()
      });

      if (error) throw error;

      this.dados.set(data as DashboardFinanceiroData);
    } catch (error) {
      this.errorMessage.set('Erro ao carregar dados financeiros.');
      console.error(error);
    } finally {
      this.isLoading.set(false);
    }
  }

  aplicarFiltro() {
    this.carregarDados();
  }
}