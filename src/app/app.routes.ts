import { Routes } from '@angular/router';
import {  LoginComponent } from './pages/login/login';
import { DashboardComponent } from './pages/dashboard/dashboard';
import { AnunciosComponent } from './pages/anuncios/anuncios';

export const routes: Routes = [

    {path:'login', component:LoginComponent},
     { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
     {path: 'dashboard', component:DashboardComponent},
     { path: 'anuncios',  component:AnunciosComponent }

];
