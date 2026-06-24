import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComercialListComponent } from './comercial-list.component';

describe('ComercialListComponent', () => {
  let component: ComercialListComponent;
  let fixture: ComponentFixture<ComercialListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComercialListComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(ComercialListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
