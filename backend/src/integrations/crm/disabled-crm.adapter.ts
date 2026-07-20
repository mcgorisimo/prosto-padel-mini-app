import { Injectable } from '@nestjs/common';
import { CrmAdapter } from './crm-adapter.interface';

@Injectable()
export class DisabledCrmAdapter implements CrmAdapter {
  getProviderName(): string {
    return 'disabled';
  }

  isConfigured(): boolean {
    return false;
  }
}
