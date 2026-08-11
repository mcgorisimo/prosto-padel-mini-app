# TD-019 — Create one accessible modal/sheet primitive

- Status: `planned`
- Priority: P1
- Effort: M (2–3 days)
- Risk: medium
- Dependencies: TD-001, TD-002
- Primary files: new UI primitive and its isolated test harness
- Migration: not needed

## Evidence and problem

Booking, match confirmations, finish result and profile photo flows implement
separate fixed overlays. Dialog semantics are inconsistent; focus is not
reliably captured/restored and Escape/backdrop/busy dismissal differs. Scroll
locking and portal use are repeated.

## TDD contract

- portal target is `document.body` and viewport bounds are exact;
- role/name/description are accessible;
- initial focus and Tab/Shift+Tab containment;
- Escape/backdrop close only when allowed;
- focus returns to the trigger;
- nested/busy dialog cannot unlock body or dismiss destructively;
- unmount restores body classes/styles/scroll exactly;
- safe-area and reduced-motion behavior.

## Implementation

Provide behavior primitives (`ModalRoot`, backdrop/panel or equivalent) with
visual variants supplied by callers. Prove it in an isolated representative
test harness, but do not migrate booking, match or profile consumers in this
task. TD-016–TD-018 own their domain wiring, and TD-020a owns shared styling.

## Acceptance criteria

- One owner for portal/focus/dismiss/scroll lifecycle.
- Public primitive contract is documented and exercised for dialog and sheet
  variants without product-domain imports.
- No existing consumer or product flow changes in this task.
- Harness has no horizontal/vertical page drift on supported mobile viewport.

## Independent review gate

Reviewer performs keyboard, WebKit viewport and cleanup audit. Score ≥9. Record
the measured deployment impact: when the unimported primitive is tree-shaken
and production bundle bytes/runtime are unchanged, deployment is `not_needed`;
otherwise follow the full frontend rollout gate.
