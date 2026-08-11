# TD-018 — Decompose profile/settings/photo UI

- Status: `planned`
- Priority: P2
- Effort: M (1–3 days; photo controller only)
- Risk: medium
- Dependencies: TD-014c, TD-019
- Primary files: `PlayerProfile.jsx` (~1,430 lines), `EditProfileScreen.jsx`,
  settings sub-screens
- Migration: not needed

## Evidence and problem

PlayerProfile mixes profile presentation, match/rating history, admin entry,
photo actions/preview/upload/crop/delete, canvas processing and modal lifecycle.
Recent portal correction proved overlays are sensitive to parent layout. Settings
screens also keep older API assumptions.

## TDD/extraction plan

1. Freeze profile mapping and truthful rating/history state after TD-008.
2. Extract photo state/controller: file validation, object URL cleanup, crop,
   busy/error and upload/delete outcomes.
3. Wire existing photo actions/full preview/crop views through TD-019 without
   extracting unrelated profile sections.
4. Ensure photo result updates exactly one backend profile truth.

Header/stats/history/admin/settings presenter work is TD-018a.

## Acceptance criteria

- Object URLs, canvas resources, body classes and focus are always cleaned.
- Photo overlays remain viewport-fixed on iOS/WebKit.
- PII/profile/admin contracts and visual design remain unchanged.
- Photo components keep no independent persisted profile copy; unrelated
  profile presentation is untouched.

## Independent review gate

Reviewer checks resource leaks, accessibility, PII and portal/scroll behavior.
Score ≥9, profile E2E/build and frontend rollout.
