import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Assistente } from './assistente';

describe('Assistente', () => {
  let component: Assistente;
  let fixture: ComponentFixture<Assistente>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Assistente]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Assistente);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
