import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// IMPORTANTE: Adicione esta linha no topo para importar o environment
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css'
})
export class LoginComponent {
  // Estado da interface
  isLoading = signal(false);
  errorMessage = signal('');
  
  // Campos do formulário
  email = signal('');
  password = signal('');

  private supabase: SupabaseClient;

  constructor(private router: Router) {
    // MAGIA AQUI: Em vez de colar chaves, puxamos do environment!
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseKey);
  }

  async fazerLogin() {
    if (!this.email() || !this.password()) {
      this.errorMessage.set('Por favor, preencha o seu email e senha.');
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set('');

    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email: this.email(),
        password: this.password()
      });

      if (error) {
        this.errorMessage.set('Credenciais inválidas. Verifique o seu email e senha.');
        console.error(error);
      } else {
        console.log('Login efetuado com sucesso!');
        // Redireciona para o painel principal após o login
        this.router.navigate(['/dashboard']);
      }
    } catch (err) {
      this.errorMessage.set('Ocorreu um erro de conexão. Tente novamente.');
    } finally {
      this.isLoading.set(false);
    }
  }
}