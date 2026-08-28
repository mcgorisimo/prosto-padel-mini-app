import { RuntimeDisabledPaymentNotificationPort } from './payment-notification.port';

describe('RuntimeDisabledPaymentNotificationPort', () => {
  it('keeps payment notification events unreachable without a canonical D4 outcome', async () => {
    const port = new RuntimeDisabledPaymentNotificationPort();
    await expect(port.publishCanonicalOutcome({} as never)).rejects.toThrow(
      'disabled until canonical D4',
    );
  });
});
