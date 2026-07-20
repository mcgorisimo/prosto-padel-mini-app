export interface CrmAdapter {
  getProviderName(): string;
  isConfigured(): boolean;
}
