import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CalculadoraPrecos } from './calculadora-precos';

describe('CalculadoraPrecos', () => {
  let component: CalculadoraPrecos;
  let fixture: ComponentFixture<CalculadoraPrecos>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CalculadoraPrecos]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CalculadoraPrecos);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
