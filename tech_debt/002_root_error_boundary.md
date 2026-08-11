# TD-002 — Root React error boundary and sanitized recovery

- Status: `review`
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

- Baseline SHA / RED: `5406651759682703cc96da2e7e61581148b6a1c6`.
  Before implementation, the focused unit suite failed because
  `./RootErrorBoundary` did not exist. The existing `index.html` global
  `window.onerror` also showed raw error text and a line number through
  `alert`; it was removed rather than retained as an unsafe fallback.
- Tests/build: focused boundary unit `4/4`; focused WebKit `3/3`; full unit
  `8 files / 28 tests`; coverage PASS at aggregate
  `56.89/86.86/71.05/56.89`. `RootErrorBoundary.jsx` retains an explicit
  `100/100/100/100` threshold. The
  nine-worker E2E attempt completed `91 passed / 1 skipped / 2 failed / 1 did
  not run` and reproduced two pre-existing resource flakes; both focused reruns
  passed `2/2`. The complete final controlled four-worker run passed `94 / 1
  skipped`. Root build PASS,
  1,619
  modules; existing Vite CJS and large-chunk warnings remain. Backend gates are
  `not_applicable` because no backend file changed. `git diff --check` PASS.
- Review score/findings: first fresh no-context review of `ef786588...` scored
  `8.4/10` with no P0, one P1 and one P2. P1: React/browser still emitted the
  raw caught exception through browser diagnostics. P2: the WebKit harness
  mounted the boundary directly and did not prove `main.jsx` integration. A
  first application-owned head bootstrap now replaces raw console output with a
  static marker and stops window-targeted `error`/`unhandledrejection`
  immediately in capture phase before Telegram/React; resource errors continue
  to element handlers, and WebKit proves both properties. The fallback test now
  replaces `AuthGate` before real application startup so the actual root
  integration is exercised. Second review of
  `1c63b83...` scored `8.1/10` with one P1 and one P2: the module-installed
  bubble listener did not confine propagation, and WORKLOG overstated stage
  reporting as WebKit coverage. Both were corrected. Third review of
  `0efb6dd...` scored `8.2/10` with one P1: capture suppression also intercepted
  resource errors before existing element/React `onError` fallbacks. The
  bootstrap now ignores non-window error targets, and focused WebKit passes
  `3/3`, including a resource-handler regression. Review of `2db97ab...` scored
  `9.2/10` with no P0/P1 and one documentation P2; the missing first-run `did
  not run` result was recorded. Review of `f3fb504...` scored `9.3/10` with no
  P0/P1 and one bounded P2: the early bootstrap pushed `<meta charset>` beyond
  the conforming prescan window. Charset now precedes the bootstrap while the
  bootstrap remains the first executable application-owned script. Final
  exact-SHA review is pending.
- Commit/push/deployment: local candidate pending; not pushed. Runtime/frontend
  bundle changes require exact-candidate Selectel test rollout after review.
