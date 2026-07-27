import { createHash } from 'node:crypto';
import {
  SessionCredentialDigest,
  isSessionCredentialDigest,
} from './session.types';

export interface IssuedSessionCredential {
  readonly plaintext: string;
  readonly digest: SessionCredentialDigest;
}

export interface SessionCredentialIssuer {
  issue(): IssuedSessionCredential;
}

export function isCanonicalSessionCredential(
  value: unknown,
): value is string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/u.test(value)
  ) {
    return false;
  }

  const decoded = Buffer.from(value, 'base64url');
  const valid =
    decoded.length === 32 && decoded.toString('base64url') === value;
  decoded.fill(0);
  return valid;
}

export function digestSessionCredential(
  credential: string,
): SessionCredentialDigest {
  if (!isCanonicalSessionCredential(credential)) {
    throw new TypeError('Session credential is invalid');
  }

  const digest = createHash('sha256')
    .update(credential, 'utf8')
    .digest('hex');
  if (!isSessionCredentialDigest(digest)) {
    throw new TypeError('Session credential digest is invalid');
  }
  return digest;
}
