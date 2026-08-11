# TD-002 — Root React error boundary and sanitized recovery

- Status: `planned`
- Priority: P0
- Effort: S (0.5–1 day)
- Risk: low
- Dependencies: TD-001
- Primary files: `src/main.jsx`, new focused boundary component/test
- Migration: not needed

## Evidence and problem

`src/main.jsx` renders splash/auth/application without any React ErrorBoundary.
A render-tree exception can leave the Telegram Mini App blank. Raw error text
must not expose bearer credentials, initData, PII or provider responses.

## TDD plan

1. RED: render a child that throws and assert a stable, non-sensitive recovery
   screen; current root has no such behavior.
2. Assert normal children render unchanged, a retry remounts the subtree, focus
   reaches the recovery action and repeated failures remain bounded.
3. Assert diagnostic reporting receives only an allowlisted component/stage
   marker, never the raw exception message or stack in user-visible output.
4. GREEN: add the smallest class boundary around authenticated app content,
   preserving splash and Telegram lifecycle semantics.

## Acceptance criteria

- No blank screen on a render exception.
- Recovery copy is truthful and accessible in a mobile WebView.
- Retry/reload behavior is deterministic and cannot loop automatically.
- Normal auth/session/profile calls and splash timing are byte-for-byte
  unchanged at their observable boundaries.
- Unit and Playwright regression cover fallback and normal path.

## Do not change

Backend error codes, auth retry policy, global design, Telegram credentials or
server logging.

## Independent review gate

Reviewer focuses on data leakage, infinite remount loops, fallback accessibility
and whether errors outside React render are falsely claimed as handled.

## Completion evidence

- Baseline SHA / RED:
- Tests/build:
- Review score/findings:
- Commit/push/deployment:
