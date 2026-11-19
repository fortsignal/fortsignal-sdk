# Changelog

## Unreleased

Offline artifact verification hardening. Ship as **0.4.0** (`npm version minor`). Do not publish a patch over 0.3.0: two of the checks below reject artifacts that 0.3.0 accepted.

### Breaking

- **`jti` is required.** An artifact with a missing or empty `jti` is rejected with `artifact_missing_jti` and is not written to the seen store. 0.3.0 accepted these tokens. Every such token shared one replay slot (`claim(undefined, …)`), so a second, different jti-less artifact was reported as `artifact_replayed`. The hosted API always sets `jti`.
- **Lifetime cap.** `exp - iat` must be ≤ 300 seconds by default (`artifact_lifetime_exceeded`), matching the hosted API. `exp` must also be ≤ now + that cap + 30s of clock skew, and `iat` must be ≤ now + skew (`artifact_not_yet_valid`). A future `iat` no longer hides a year-long expiry behind a short delta. A missing `iat` fails the cap. 0.3.0 accepted a year-long `exp` and tokens with no `iat`. Self-hosted issuers that mint a longer window pass `maxLifetimeSeconds`.
- **Empty `tenant` throws.** `verifyArtifact({ tenant: '' })` throws instead of skipping the tenant check. Omit the option to skip it. An unset env var coerced with `?? ''` must be rejected at startup.
- **`SeenStore.claim` second argument** is the last second the verifier will accept the artifact (`exp` + 30s clock skew), not the raw `exp`. Stores that set a TTL of `argument - now` now cover the skew window, which is the safe direction. A store that saved the argument as the token's `exp` will see a timestamp 30 seconds later.

### Fixed

- **Replay inside the clock-skew window.** `MemorySeenStore` kept each id only until `exp`, while `verifyArtifact` accepts the artifact until `exp` + 30s. A second presentation in that gap verified again. Ids are now retained through the last accepted second. Eviction uses a deadline heap, so a claim does not scan every entry.
- **Redis seen-store recipe.** `PX = exp*1000 - Date.now()` goes non-positive while the verifier is still accepting, and Redis rejects `PX <= 0` (`ERR invalid expire time` → `artifact_store_unavailable`). That rejected replays and legitimate first uses inside the skew window. `seenRetentionMs` returns a positive integer TTL through the end of the retention second. The README and enterprise guide use it.
- **Unknown `kid`.** A cached JWKS that does not contain the artifact's `kid` is refetched before `artifact_unknown_kid`, at most once per 30 seconds. Concurrent verifies share one in-flight fetch. The fetch times out after 5 seconds (`AbortSignal.timeout`). A failed or timed-out refresh keeps serving the last successful keys for up to an hour, then fails closed with `artifact_keys_unavailable`.
- **Numeric dates.** Non-finite values (`1e309` parses as `Infinity`) and absurd magnitudes (`1e308`, where `n + 30 === n`) on `iat`, `exp`, or `nbf` are `artifact_malformed`. A present non-numeric `nbf` (string, null, object) is `artifact_malformed` too. A missing `nbf` is still allowed.

### Added

- `FortSignalOptions.issuer` — expected `iss`. Default remains `https://api.fortsignal.com`. A custom `baseUrl` does not change the issuer.
- `VerifyArtifactOptions.tenant` — when set, `sub` must equal it. If `aud` is present (string or array of strings), it must include it (`artifact_tenant_mismatch`, `artifact_audience_mismatch`). Omitted means no tenant check, so existing callers keep working; production executors should set it. The hosted API sets `sub` to the tenant id.
- `VerifyArtifactOptions.maxLifetimeSeconds` — overrides the 300s cap.
- `seenRetentionMs(retainUntilEpochSeconds)` — Redis `PX` helper for the seen-store recipe.
- Error codes: `artifact_missing_jti`, `artifact_lifetime_exceeded`, `artifact_tenant_mismatch`, `artifact_audience_mismatch`.
- `CHANGELOG.md` is included in the published package (`package.json` `files`).
