import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Anuncios } from './anuncios';

describe('Anuncios', () => {
  let component: Anuncios;
  let fixture: ComponentFixture<Anuncios>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Anuncios]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Anuncios);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
