export type MembershipStatus =
  | 'active'
  | 'scheduled'
  | 'expired'
  | 'exhausted';

export type OwnMembership = Readonly<{
  id: string;
  title: string;
  status: MembershipStatus;
  remainingVisits: number | null;
  expiresOn: string | null;
}>;

export type MembershipProduct = Readonly<{
  id: string;
  title: string;
  description: string | null;
  visitCount: number | null;
  validityDays: number | null;
}>;

export type OwnMembershipsResponse =
  | Readonly<{ outcome: 'not_configured'; memberships: readonly [] }>
  | Readonly<{ outcome: 'unavailable'; memberships: readonly [] }>
  | Readonly<{
      outcome: 'loaded';
      memberships: readonly OwnMembership[];
    }>;
export type MembershipCatalogResponse =
  | Readonly<{ outcome: 'not_configured'; products: readonly [] }>
  | Readonly<{ outcome: 'unavailable'; products: readonly [] }>
  | Readonly<{
      outcome: 'loaded';
      products: readonly MembershipProduct[];
    }>;
