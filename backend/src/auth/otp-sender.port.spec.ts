import { deterministicUuid } from '../../test/deterministic-uuid';
import { unixEpochSeconds } from './auth.types';
import {
  OtpSenderOutcome,
  OtpSenderPort,
  OtpSenderRequest,
} from './otp-sender.port';
import { OtpChallengeId } from './otp.types';

class FakeOtpSender implements OtpSenderPort {
  readonly received: OtpSenderRequest[] = [];

  constructor(private readonly configuredOutcome: OtpSenderOutcome) {}

  async send(request: OtpSenderRequest): Promise<OtpSenderOutcome> {
    this.received.push(
      Object.freeze({
        channel: request.channel,
        challengeId: request.challengeId,
        destination: request.destination,
        plaintextCode: request.plaintextCode,
        expiresAt: request.expiresAt,
      }),
    );
    return this.configuredOutcome;
  }
}

function senderRequest(): OtpSenderRequest {
  return {
    channel: 'sms',
    challengeId: deterministicUuid('otp-challenge-1') as OtpChallengeId,
    destination: '+79990000000',
    plaintextCode: '123456',
    expiresAt: unixEpochSeconds(1_784_700_300),
  };
}

describe('OTP sender port', () => {
  it('lets a test-only fake accept one transient SMS request', async () => {
    const sender = new FakeOtpSender({ outcome: 'accepted' });
    const request = senderRequest();

    await expect(sender.send(request)).resolves.toEqual({ outcome: 'accepted' });
    expect(sender.received).toEqual([request]);
  });

  it('lets a test-only fake report unavailable without network access', async () => {
    const sender = new FakeOtpSender({ outcome: 'unavailable' });

    await expect(sender.send(senderRequest())).resolves.toEqual({
      outcome: 'unavailable',
    });
    expect(sender.received).toHaveLength(1);
  });

  it('does not retain the sender request through a shared mutable reference', async () => {
    const sender = new FakeOtpSender({ outcome: 'accepted' });
    const request = { ...senderRequest() };
    await sender.send(request);

    request.destination = '+70000000000';
    request.plaintextCode = '000000';

    expect(sender.received[0]).toMatchObject({
      destination: '+79990000000',
      plaintextCode: '123456',
    });
    expect(sender.received[0]).not.toBe(request);
  });
});
