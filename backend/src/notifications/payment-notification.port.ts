import { AccountId } from '../accounts/account.types';

export type CanonicalPaymentNotificationOutcome = Readonly<{
  eventId: string;
  payerAccountId: AccountId;
  outcome: 'succeeded' | 'failed';
}>;

export interface PaymentNotificationPort {
  publishCanonicalOutcome(
    outcome: CanonicalPaymentNotificationOutcome,
  ): Promise<never>;
}

/**
 * D4 has no canonical runtime payment outcome source yet. Keeping this port
 * unwired and terminal prevents legacy UI/payment booleans from asserting a
 * Telegram payment result.
 */
export class RuntimeDisabledPaymentNotificationPort implements PaymentNotificationPort {
  async publishCanonicalOutcome(
    _outcome: CanonicalPaymentNotificationOutcome,
  ): Promise<never> {
    throw new Error('Payment notifications are disabled until canonical D4');
  }
}
