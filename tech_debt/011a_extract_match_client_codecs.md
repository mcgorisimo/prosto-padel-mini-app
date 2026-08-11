# TD-011a — Extract match feed/detail/invitation client codecs

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-011, TD-007a
- Primary files: `src/lib/backendSessionClient.js`, new match/invitation modules
- Migration: not needed

## Problem and target

Match feed/detail and invitation schemas remain embedded in the facade after
TD-011. Move only these codecs/classifiers and methods behind the unchanged
public client, sharing the bounded transport rather than cloning it.

## TDD plan

- freeze exact-key/prototype/date/status/cursor and size-cap failures;
- freeze feed/detail/invitation URLs, headers, query encoding and request keys;
- extract pure codecs first, then client methods, maintaining export-key parity;
- fuzz malformed nested participant/invitation payloads and unknown statuses.

## Acceptance criteria

- One transport implementation; domain modules contain no credential storage.
- Existing public facade and wire behavior remain byte/semantic compatible.
- No loosened exact-key validation, mutation retry or swallowed abort reason.
- Other social domains remain untouched for TD-011b/011c.

## Review/completion evidence

Fresh review focuses wire/security parity and scores ≥9. Record focused/full
tests, facade key inventory, commit/push and frontend rollout.
