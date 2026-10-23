import { Component, Input, OnChanges, signal } from '@angular/core';

@Component({
  selector: 'app-produto-imagem', standalone: true,
  template: `
    @if (url && !falhou()) {
      <img [src]="url" [alt]="titulo" loading="lazy" (error)="falhou.set(true)">
    } @else {
      <span role="img" [attr.aria-label]="'Imagem não disponível para ' + titulo">Sem foto</span>
    }
  `,
  styles: `
    :host { display: grid; place-items: center; width: 100%; height: 100%; min-width: 0;
      border-radius: inherit; background: #f1f5f9; color: #64748b; font-size: .65rem; }
    img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
  `,
})
export class ProdutoImagemComponent implements OnChanges {
  @Input() url: string | null = null;
  @Input() titulo = 'produto';
  falhou = signal(false);
  ngOnChanges() { this.falhou.set(false); }
}
