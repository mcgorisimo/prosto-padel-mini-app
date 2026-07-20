import { Injectable } from '@nestjs/common';
import { CrmAdapter } from '../crm/crm-adapter.interface';

@Injectable()
export class YclientsAdapter implements CrmAdapter {
  getProviderName(): string {
    return 'yclients';
  }

  isConfigured(): boolean {
    return false;
  }
}
