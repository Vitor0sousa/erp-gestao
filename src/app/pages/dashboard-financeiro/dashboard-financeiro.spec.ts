import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DashboardFinanceiro } from './dashboard-financeiro';

describe('DashboardFinanceiro', () => {
  let component: DashboardFinanceiro;
  let fixture: ComponentFixture<DashboardFinanceiro>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardFinanceiro]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DashboardFinanceiro);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
