import { createHmac } from 'node:crypto';
import {
  ComputedExternalIdentityLookupDigest,
  EXTERNAL_IDENTITY_LOOKUP_DIGEST_ALGORITHM,
  ExternalIdentityLookupDigestPepperVersion,
  ExternalIdentityLookupDigestPort,
  ExternalIdentityLookupDigestVersion,
  ExternalIdentityLookupDigestComputationInput,
  externalIdentityLookupDigestPepperVersion,
  externalIdentityLookupDigestVersion,
} from '../accounts/external-identity-lookup-digest.port';
import {
  EXTERNAL_IDENTITY_PROVIDERS,
  externalIdentityLookupDigest,
  externalIdentityNamespace,
  trustProviderCanonicalizedExternalIdentitySubject,
} from '../accounts/external-identity.types';
import { VerifiedTelegramProof } from './auth.types';
import {
  TelegramLookupDigestCandidates,
  TelegramLookupDigestCandidatesPort,
} from './telegram-login.ports';
import { encodeLengthPrefixedUtf8 } from './crypto-encoding';

const LOOKUP_DOMAIN = 'prosto-padel/external-identity-lookup/v1';
const MINIMUM_PEPPER_BYTES = 32;

export interface TelegramLookupDigestAdapterConfig {
  readonly digestVersion: ExternalIdentityLookupDigestVersion;
  readonly pepperVersion: ExternalIdentityLookupDigestPepperVersion;
  readonly pepper: Buffer;
}

export type TelegramLookupDigestAdapterFailure =
  | 'invalid_config'
  | 'invalid_input'
  | 'crypto_failure';

export class TelegramLookupDigestAdapterError extends Error {
  readonly name = 'TelegramLookupDigestAdapterError';

  constructor(readonly reason: TelegramLookupDigestAdapterFailure) {
    super('Telegram lookup digest computation failed');
  }
}

function failure(
  reason: TelegramLookupDigestAdapterFailure,
): TelegramLookupDigestAdapterError {
  return new TelegramLookupDigestAdapterError(reason);
}

export class TelegramLookupDigestCandidatesAdapter
  implements TelegramLookupDigestCandidatesPort, ExternalIdentityLookupDigestPort
{
  readonly #digestVersion: ExternalIdentityLookupDigestVersion;
  readonly #pepperVersion: ExternalIdentityLookupDigestPepperVersion;
  readonly #pepper: Buffer;

  constructor(config: TelegramLookupDigestAdapterConfig) {
    try {
      if (
        typeof config !== 'object' ||
        config === null ||
        !Buffer.isBuffer(config.pepper) ||
        config.pepper.length < MINIMUM_PEPPER_BYTES
      ) {
        throw failure('invalid_config');
      }

      this.#digestVersion = externalIdentityLookupDigestVersion(
        config.digestVersion,
      );
      this.#pepperVersion = externalIdentityLookupDigestPepperVersion(
        config.pepperVersion,
      );
      this.#pepper = Buffer.from(config.pepper);
    } catch (error) {
      if (error instanceof TelegramLookupDigestAdapterError) {
        throw error;
      }
      throw failure('invalid_config');
    }
  }

  async compute(
    input: ExternalIdentityLookupDigestComputationInput,
  ): Promise<ComputedExternalIdentityLookupDigest> {
    try {
      if (
        typeof input !== 'object' ||
        input === null ||
        typeof input.provider !== 'string' ||
        !(EXTERNAL_IDENTITY_PROVIDERS as readonly string[]).includes(
          input.provider,
        )
      ) {
        throw failure('invalid_input');
      }
      const namespace = externalIdentityNamespace(input.namespace);
      const canonicalSubject =
        trustProviderCanonicalizedExternalIdentitySubject(
          input.canonicalSubject,
        );
      const digestVersion = externalIdentityLookupDigestVersion(
        input.digestVersion,
      );
      const pepperVersion = externalIdentityLookupDigestPepperVersion(
        input.pepperVersion,
      );
      if (
        digestVersion !== this.#digestVersion ||
        pepperVersion !== this.#pepperVersion
      ) {
        throw failure('invalid_input');
      }

      const preimage = encodeLengthPrefixedUtf8([
        LOOKUP_DOMAIN,
        input.provider,
        namespace,
        canonicalSubject,
        digestVersion.toString(10),
        pepperVersion.toString(10),
      ]);
      const digest = externalIdentityLookupDigest(
        createHmac('sha256', this.#pepper)
          .update(preimage)
          .digest('hex'),
      );

      return Object.freeze({
        algorithm: EXTERNAL_IDENTITY_LOOKUP_DIGEST_ALGORITHM,
        provider: input.provider,
        namespace,
        digest,
        digestVersion,
        pepperVersion,
      });
    } catch (error) {
      if (error instanceof TelegramLookupDigestAdapterError) {
        throw error;
      }
      if (error instanceof TypeError) {
        throw failure('invalid_input');
      }
      throw failure('crypto_failure');
    }
  }

  async computeCandidates(
    proof: VerifiedTelegramProof,
  ): Promise<TelegramLookupDigestCandidates> {
    try {
      if (
        proof.provider !== 'telegram' ||
        proof.identityKey.provider !== 'telegram' ||
        proof.identityKey.namespace !== proof.namespace ||
        proof.identityKey.lookup.kind !== 'canonical_subject'
      ) {
        throw failure('invalid_input');
      }

      const candidate = await this.compute({
        provider: 'telegram',
        namespace: proof.namespace,
        canonicalSubject: proof.identityKey.lookup.subject,
        digestVersion: this.#digestVersion,
        pepperVersion: this.#pepperVersion,
      });
      return Object.freeze({
        primary: candidate,
        all: Object.freeze([candidate]),
      });
    } catch (error) {
      if (error instanceof TelegramLookupDigestAdapterError) {
        throw error;
      }
      throw failure('invalid_input');
    }
  }
}
