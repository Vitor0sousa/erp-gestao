import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

interface ProdutoInterno {
  id: string;
  sku_interno: string;
  nome_produto: string;
  tipo: string;
}

interface RascunhoIA {
  titulo_sugerido: string;
  descricao_sugerida: string;
  imagens_selecionadas: string[];
  aviso_ia: string;
}

@Component({
  selector: 'app-assistente-ia',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './assistente.html',
  styleUrl: './assistente.css'
})
export class AssistenteIaComponent implements OnInit {
  produtos = signal<ProdutoInterno[]>([]);
  produtoAtivo = signal<ProdutoInterno | null>(null);
  
  rascunho = signal<RascunhoIA | null>(null);
  isLoading = signal(false);
  
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseKey);
  }

  ngOnInit() {
    this.carregarProdutos();
  }

  async carregarProdutos() {
    const { data } = await this.supabase
      .from('produtos_internos')
      .select('id, sku_interno, nome_produto, tipo')
      .order('nome_produto', { ascending: true });
    
    if (data) this.produtos.set(data);
  }

  selecionarProduto(prod: ProdutoInterno) {
    this.produtoAtivo.set(prod);
    this.rascunho.set(null); // Limpa o rascunho anterior
  }

  async gerarComIA() {
    const prod = this.produtoAtivo();
    if (!prod) return;

    this.isLoading.set(true);
    this.rascunho.set(null);

    try {
      const { data: { session } } = await this.supabase.auth.getSession();
      
      const edgeUrl = `${environment.supabaseUrl}/functions/v1/gerar-anuncio-ia`;
      const res = await fetch(edgeUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ produto_id: prod.id })
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      this.rascunho.set(json);
    } catch (err: any) {
      alert("Erro do Assistente: " + err.message);
    } finally {
      this.isLoading.set(false);
    }
  }
}