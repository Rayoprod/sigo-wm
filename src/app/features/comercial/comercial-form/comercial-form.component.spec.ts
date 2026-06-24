import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComercialFormComponent } from './comercial-form.component';

describe('ComercialFormComponent', () => {
  let component: ComercialFormComponent;
  let fixture: ComponentFixture<ComercialFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComercialFormComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(ComercialFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
