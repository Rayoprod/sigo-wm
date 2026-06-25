import { TestBed } from '@angular/core/testing';

import { ApiPeruService } from './api-peru.service';

describe('ApiPeruService', () => {
  let service: ApiPeruService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ApiPeruService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
