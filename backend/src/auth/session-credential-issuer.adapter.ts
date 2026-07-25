import { createHash, randomBytes } from 'node:crypto';
import {
  IssuedSessionCredential,
  SessionCredentialIssuer,
} from './telegram-login.ports';
import { isSessionCredentialDigest } from './session.types';

const CREDENTIAL_BYTES = 32;

export type SessionCredentialIssuerAdapterFailure = 'crypto_failure';

export class SessionCredentialIssuerAdapterError extends Error {
  readonly name = 'SessionCredentialIssuerAdapterError';

  constructor(readonly reason: SessionCredentialIssuerAdapterFailure) {
    super('Session credential issuance failed');
  }
}

function failure(
  reason: SessionCredentialIssuerAdapterFailure,
): SessionCredentialIssuerAdapterError {
  return new SessionCredentialIssuerAdapterError(reason);
}

export class NodeSessionCredentialIssuer implements SessionCredentialIssuer {
  issue(): IssuedSessionCredential {
    let randomMaterial: Buffer | undefined;

    try {
      randomMaterial = randomBytes(CREDENTIAL_BYTES);
      const plaintext = randomMaterial.toString('base64url');
      const digestValue = createHash('sha256')
        .update(plaintext, 'utf8')
        .digest('hex');
      if (!isSessionCredentialDigest(digestValue)) {
        throw failure('crypto_failure');
      }

      return Object.freeze({ plaintext, digest: digestValue });
    } catch (error) {
      if (error instanceof SessionCredentialIssuerAdapterError) {
        throw error;
      }
      throw failure('crypto_failure');
    } finally {
      randomMaterial?.fill(0);
    }
  }
}
