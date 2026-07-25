import { createHash } from 'node:crypto';
import {
  NodeSessionCredentialIssuer,
  SessionCredentialIssuerAdapterError,
} from './session-credential-issuer.adapter';

function typecheckProductionConstructorBoundary(): void {
  // @ts-expect-error Production issuer intentionally rejects RNG injection.
  new NodeSessionCredentialIssuer(() => Buffer.alloc(32));
}

describe('NodeSessionCredentialIssuer', () => {
  it('has a zero-argument production constructor', () => {
    expect(NodeSessionCredentialIssuer.length).toBe(0);
    expect(typecheckProductionConstructorBoundary).toBeDefined();
    expect(() => new NodeSessionCredentialIssuer()).not.toThrow();
  });

  it('issues 32 random bytes as 43-character unpadded base64url', () => {
    const issued = new NodeSessionCredentialIssuer().issue();

    expect(issued.plaintext).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(issued.plaintext).not.toContain('=');
    expect(Buffer.from(issued.plaintext, 'base64url')).toHaveLength(32);
  });

  it('hashes the exact UTF-8 plaintext to a lowercase SHA-256 digest', () => {
    const issued = new NodeSessionCredentialIssuer().issue();
    const expected = createHash('sha256')
      .update(issued.plaintext, 'utf8')
      .digest('hex');

    expect(issued.digest).toBe(expected);
    expect(issued.digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(issued.digest).not.toBe(issued.plaintext);
  });

  it('issues different credentials on consecutive production calls', () => {
    const issuer = new NodeSessionCredentialIssuer();
    const first = issuer.issue();
    const second = issuer.issue();

    expect(second.plaintext).not.toBe(first.plaintext);
    expect(second.digest).not.toBe(first.digest);
  });

  it('exposes no state or method that can replace the production RNG', () => {
    const issuer = new NodeSessionCredentialIssuer();
    expect(Object.getOwnPropertyNames(issuer)).toEqual([]);
    expect(Object.getOwnPropertyNames(NodeSessionCredentialIssuer.prototype)).toEqual([
      'constructor',
      'issue',
    ]);
  });

  it('uses a fixed safe error shape without raw bytes or plaintext', () => {
    const rawMarker = 'raw-random-bytes-secret-marker';
    const plaintextMarker = 'plaintext-credential-secret-marker';
    const safe = new SessionCredentialIssuerAdapterError('crypto_failure');

    expect(Object.getOwnPropertyNames(safe).sort()).toEqual(
      ['message', 'name', 'reason', 'stack'].sort(),
    );
    expect('cause' in safe).toBe(false);
    const serialized = `${safe.message}\n${safe.stack}\n${JSON.stringify(safe)}`;
    expect(serialized).not.toContain(rawMarker);
    expect(serialized).not.toContain(plaintextMarker);
  });
});
