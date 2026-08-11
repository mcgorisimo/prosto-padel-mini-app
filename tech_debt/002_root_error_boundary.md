# TD-002 — Root React error boundary and sanitized recovery

- Status: `done`
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
  exact-SHA review of `044aeff...` scored `9.8/10` with no P0/P1/P2.
- Final reviewed candidate:
  `044aeffb71077fcde52d2eabadcc6145610f0f64`. It was pushed to exact
  `origin/main` before deployment.
- Deployment: `test_deployed`. Selectel test is on clean detached exact
  `044aeffb71077fcde52d2eabadcc6145610f0f64`. Only frontend was
  rebuilt/recreated: container `d6e625d033b5...` / image
  `sha256:11fe29e9d05c...` became `15a637d33d6c...` / image
  `sha256:d873752c9238...`. Backend `7ca6956f77fb...`, nginx
  `e5b98b53a385...` and PostgreSQL `5e36d4dc1a5c...`, with their images,
  remained unchanged. All four containers are healthy with restart `0`.
  HTTPS root/health are `200`; exact asset `/assets/index-CD2hPLLo.js` is
  `200`, `608422` bytes. Charset prescan, static diagnostic marker and absence
  of the legacy raw alert handler are verified. Direct-browser smoke reached
  the Telegram-only `outside_telegram` boundary without fallback, dialog or
  error log. Bounded frontend/backend/nginx critical counts and nginx 5xx are
  all `0`. DB/schema/migrations, YCLIENTS, payment/provider, secrets and
  production were not changed.

## Final independent review transcript

Exact prompt sent to fresh no-context reviewer `/root/td002_final_review_4`:

> Fresh no-context final independent review. Repository:
> `C:\Projects\prosto-padel-mini-app`. Baseline SHA:
> `5406651759682703cc96da2e7e61581148b6a1c6`. Exact candidate SHA:
> `044aeffb71077fcde52d2eabadcc6145610f0f64`. Task file:
> `tech_debt/002_root_error_boundary.md`. Read-only only: no edits, commits,
> push, deploy, external/network calls, or long test reruns. Inspect exact
> diff/tree independently. Report P0/P1/P2 with precise file/line evidence and
> score 1-10; pass requires no P0/P1 and >=9. Re-audit complete scope: charset
> is within conforming prescan and the confidentiality bootstrap remains first
> executable application-owned script before Telegram/React; raw
> console/window ErrorEvent/unhandledrejection payload confinement; resource
> error delivery; meaningful WebKit and actual main root integration;
> stage-only reporter unit attribution; bounded retry/repeated/reporter
> behavior; accessibility/mobile copy; unchanged splash/auth/session; honest
> recovery scope; 100% boundary coverage; coherent 95-test evidence and latest
> 94/1 full pass; acceptable observability/runtime effects. Return concise
> verbatim report.

Verbatim reviewer report:

> Final independent review:
> `5406651759682703cc96da2e7e61581148b6a1c6` ->
> `044aeffb71077fcde52d2eabadcc6145610f0f64`
>
> - P0: none
> - P1: none
> - P2: none
> - Score: **9.8/10 — PASS**
>
> Evidence:
>
> - `index.html:4-40`: charset is at byte 48; confidentiality bootstrap is the
>   first executable application-owned script and precedes Telegram/React.
> - `index.html:7-29`: raw `console.error`, window `ErrorEvent`, and
>   `unhandledrejection` payloads are replaced by a static marker and stopped
>   before later listeners. Non-window resource errors pass through.
> - `tests/e2e/root-error-boundary.spec.js:40-106`: meaningful WebKit coverage
>   proves listener confinement and real image resource-error delivery.
> - `src/main.jsx:33-36` and
>   `tests/e2e/root-error-boundary.spec.js:108-164`: boundary wraps the real
>   `AuthGate` integration; fallback/retry is exercised through actual
>   application startup.
> - `src/components/RootErrorBoundary.jsx:73-129`: retry is explicit,
>   remount-keyed, non-automatic, and repeated reporter/child failures remain
>   bounded. Reporter receives only the frozen stage marker.
> - `src/components/RootErrorBoundary.test.jsx:29-108`: unit coverage correctly
>   attributes stage-only reporting and covers focus, sanitization, remount,
>   repeated failure, and reporter failure.
> - `vitest.config.mjs:23-34`: explicit per-file 100% ratchet; recorded summary
>   confirms `100/100/100/100`.
> - Recovery UI has truthful scope/copy, preserved focus outline, 48px action,
>   safe-area padding, responsive sizing, semantic heading/alert, and adequate
>   contrast.
> - Splash/auth/session implementation is unchanged except for the boundary
>   wrapper; documentation honestly excludes async callbacks, event handlers,
>   and failures outside the subtree.
> - Inventory is exactly 95 WebKit tests; recorded
>   `91 passed / 1 skipped / 2 failed / 1 did not run` totals 95, and latest
>   controlled full result `94 passed / 1 skipped` is coherent.
> - Global diagnostic suppression reduces client-side detail but retains
>   occurrence markers, preserves resource recovery and server logging, and is
>   acceptable for the stated confidentiality requirement.
