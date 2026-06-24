import { Routes } from '@angular/router';
import {  LoginComponent } from './pages/login/login';
import { DashboardComponent } from './pages/dashboard/dashboard';
import { AnunciosComponent } from './pages/anuncios/anuncios';
import { LayoutComponent } from './layout/layout';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
 
  // Todas as páginas autenticadas vivem dentro do LayoutComponent
  // que carrega a sidebar uma única vez e nunca a destrói
  {
    path: '',
    component: LayoutComponent,
    children: [
      { path: 'dashboard', component: DashboardComponent },
      { path: 'anuncios',  component: AnunciosComponent  },
      // Adicione novas páginas aqui sem tocar na sidebar
    ]
  }
];
