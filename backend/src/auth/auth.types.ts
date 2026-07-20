import {
  AccountId,
  AccountStatus,
  UserRole,
} from '../accounts/account.types';
import {
  ExternalIdentityProvider,
  ExternalIdentityReference,
} from '../accounts/external-identity.types';

export interface VerifiedExternalIdentityBase
  extends ExternalIdentityReference {
  readonly verifiedAt: Date;
}

export interface VerifiedTelegramIdentity
  extends VerifiedExternalIdentityBase {
  readonly provider: 'telegram';
  readonly authDate: Date;
  readonly firstName: string;
  readonly lastName?: string;
  readonly username?: string;
  readonly languageCode?: string;
  readonly photoUrl?: string;
}

export type VerifiedExternalIdentity = VerifiedTelegramIdentity;

export interface SessionMetadata {
  readonly sessionId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly authProvider: ExternalIdentityProvider;
  readonly externalIdentitySubject: string;
}

export type AdminStepUpState =
  | {
      readonly status: 'not_verified';
    }
  | {
      readonly status: 'verified';
      readonly method: 'totp';
      readonly verifiedAt: Date;
      readonly expiresAt: Date;
    };

export interface AuthenticatedPrincipal {
  readonly accountId: AccountId;
  readonly role: UserRole;
  readonly accountStatus: AccountStatus;
  readonly session: SessionMetadata;
  readonly adminStepUp: AdminStepUpState;
}
