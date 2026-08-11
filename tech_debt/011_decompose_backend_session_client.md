# TD-011 — Extract shared frontend transport and auth/profile codecs

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-001, TD-006
- Primary file: `src/lib/backendSessionClient.js` (~3,485 lines)
- Migration: not needed

## Evidence and problem

One file owns transport limits/retries/body streaming plus every strict schema.
This first bounded task extracts the shared transport and only session/profile/
photo codecs while preserving the facade. Match and social domains move in
TD-011a–TD-011c.

## Target boundaries

- `backendTransport`: bearer header, timeout, abort, bounded streaming, retry
  policy and request-key handling;
- domain codecs/classifiers in this task: auth/session, profile and photo;
- small client factories composed behind the current public facade.

## TDD plan

1. Move existing pure validator cases to TD-001 unit tests, including exact-key,
   prototype, body cap and malformed date/cursor cases.
2. Freeze transport matrix: retry only approved refresh/login cases; never
   retry mutation with unknown outcome; cancel reader on abort/oversize.
3. Extract auth/session and profile/photo without changing exported facade,
   freeze/order or error outcomes.
4. Add action-key parity for the methods owned by this slice; later tasks extend
   it as each domain moves.

## Acceptance criteria

- No domain module imports React or credential storage.
- `backendSessionClient` domains share one implementation of timeout/body/retry
  mechanics; TD-011d/011e migrate the remaining login/booking transports so the
  repository ultimately has one frontend transport core.
- Public client API, payloads, URLs, headers and strict failure mapping are
  identical.
- Remaining match/social methods stay in place until TD-011a–TD-011c.
- Extracted modules do not import credential storage or React.

## Independent review gate

Reviewer audits security, abort races, retry/idempotency and auth/profile schema
strictness. Score ≥9; all root gates and frontend rollout required.
