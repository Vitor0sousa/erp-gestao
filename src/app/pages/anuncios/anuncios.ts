import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

interface MeliAnuncio {
  id: string;
  item_id_meli: string;
  titulo_anuncio: string;
  foto_url: string | null;
  conta_id: string;
}

@Component({
  selector: 'app-anuncios',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './anuncios.html',
  styleUrl: './anuncios.css'
})
export class AnunciosComponent implements OnInit {
  anuncios       = signal<MeliAnuncio[]>([]);
  isLoading      = signal(true);
  isSyncing      = signal(false);
  errorMessage   = signal('');
  syncMessage    = signal('');
  busca          = signal('');

  anunciosFiltrados = computed(() => {
    const termo = this.busca().toLowerCase().trim();
    if (!termo) return this.anuncios();
    return this.anuncios().filter(a =>
      a.titulo_anuncio?.toLowerCase().includes(termo) ||
      a.item_id_meli?.toLowerCase().includes(termo)
    );
  });

  totalSemFoto = computed(() =>
    this.anuncios().filter(a => !a.foto_url).length
  );

  private supabase: SupabaseClient;

  constructor() {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseKey);
  }

  ngOnInit() {
    this.carregarAnuncios();
  }

  async carregarAnuncios() {
    this.isLoading.set(true);
    this.errorMessage.set('');
    try {
      const { data, error } = await this.supabase
        .from('meli_anuncios')
        .select('*')
        .order('titulo_anuncio', { ascending: true });

      if (error) throw error;
      this.anuncios.set(data || []);
    } catch (err) {
      this.errorMessage.set('Erro ao carregar anúncios. Verifique a conexão.');
      console.error(err);
    } finally {
      this.isLoading.set(false);
    }
  }

  async sincronizarAnuncios() {
    this.isSyncing.set(true);
    this.syncMessage.set('');
    this.errorMessage.set('');

    try {
      const { data: { session } } = await this.supabase.auth.getSession();
      if (!session) throw new Error('Sessão inválida.');

      const res = await fetch(
        `${environment.supabaseUrl}/functions/v1/meli-sync`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          }
        }
      );

      const resultado = await res.json();

      if (!res.ok || !resultado.ok) {
        throw new Error(resultado.erro || 'Falha na sincronização.');
      }

      this.syncMessage.set('Anúncios sincronizados com sucesso!');
      await this.carregarAnuncios();

      // Limpa a mensagem de sucesso após 5s
      setTimeout(() => this.syncMessage.set(''), 5000);

    } catch (err: any) {
      this.errorMessage.set(`Erro na sincronização: ${err.message}`);
      console.error(err);
    } finally {
      this.isSyncing.set(false);
    }
  }

  abrirNoML(itemId: string) {
    window.open(`https://www.mercadolivre.com.br/anuncio/${itemId}`, '_blank');
  }
}