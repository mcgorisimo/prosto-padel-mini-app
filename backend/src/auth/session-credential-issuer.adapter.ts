import { randomBytes } from 'node:crypto';
import {
  digestSessionCredential,
  IssuedSessionCredential,
  SessionCredentialIssuer,
} from './session-credential';

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
      return Object.freeze({
        plaintext,
        digest: digestSessionCredential(plaintext),
      });
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
