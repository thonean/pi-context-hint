# Automatic summary thinking recovery

Status: Draft for review. This document proposes behavior; it does not describe an implemented feature.

## Decision

When the summary provider explicitly rejects the selected thinking level, Context Hint can select a supported level and retry once. Before retrying, it shows one Warning that names the rejected level and the replacement. It does not ask for confirmation or add a separate inference-cost warning.

For the observed Off-to-Low case, the user sees:

> Current summary model does not support thinking Off. Retrying with Low, its lowest supported level.

The correction applies only to Context Hint summaries. It does not change the main conversation model or its thinking level.

## Observed failure

A real Pi TUI experiment used `headroom/gpt-6.1-sol` with identical evidence and initial summary state. Both `inherit` and explicit model selection produced identical provider payload hashes for the initial requests and, separately, for their repair requests.

| Summary selection | Requested thinking | Provider effort | Observed result |
| --- | --- | --- | --- |
| Inherit `gpt-6.1-sol` | Off | `none` | Initial and repair requests rejected |
| Explicit `gpt-6.1-sol` | Off | `none` | Initial and repair requests rejected |
| Explicit `gpt-6.1-sol` | Low | `low` | First request returned a valid `context_hint_v1` call |

The failed responses had `stopReason: "error"`, empty content, and this provider error:

```json
{
  "code": "unsupported_value",
  "param": "reasoning.effort",
  "type": "invalid_request_error",
  "message": "Unsupported value: 'none' is not supported with the 'gpt-6.1-sol' model. Supported values are: 'low', 'medium', 'high', 'xhigh', and 'max'."
}
```

The SDK error message reported HTTP 400. The successful Low request was observed as HTTP 200 with `stopReason: "toolUse"`. This is one controlled comparison, not a reliability estimate or a guarantee about every provider.

The current local capability declaration advertises Off as `none`. Context Hint therefore selects Off by default. The backend rejects that value. The extension then decodes the empty response without inspecting the provider failure, replaces the useful error with `Expected one tool call or JSON text`, and repeats the rejected parameter in a JSON-repair request.

Relevant implementation points are [`resolveThinkingLevel`](../extensions/context-hint.ts), `requestOptions`, `generateHint`, `decodeHint`, and `runGeneration` in the same file. [`src/core.ts`](../src/core.ts) defines the thinking-level order and persisted generation state.

## Goals and exclusions

The user should receive a usable summary when one clearly supported thinking correction is sufficient. If recovery fails, the card should show the generation error rather than a successful-looking empty summary.

This design does not repair the global model catalogue, discover capabilities through trial-and-error requests, change summary models, or search for an optimal thinking level. It does not add a confirmation dialog, a configuration toggle, or background probes.

## Recovery state

Keep requested and effective thinking levels distinct. The requested level comes from the existing summary configuration and default resolver. The effective level is the level used for a particular request, possibly after a previously accepted correction.

One generation owns its prepared evidence and prior summary states, requested level, effective level, and request count. Each attempt records its effective logical level and the corresponding rejected wire value when known. These inputs remain fixed while it retries, except for the effective level or the existing format-repair suffix.

Classify each result before decoding summary content:

| Result | Action |
| --- | --- |
| Aborted or stale generation | Stop without changing summary state or learned settings |
| Recognized unsupported thinking value | Consider one capability correction |
| Other provider failure | Report the sanitized provider error |
| Successful response with invalid summary content | Consider one JSON/schema repair |
| Successful response with a valid summary | Commit the hint and state patches |

A provider error is not evidence that the summary JSON needs repair. Empty content alone is not evidence that thinking should change.

## Recognizing a correctable error

A correction requires all of the following:

- The response or thrown provider error explicitly rejects a thinking parameter. The observed supported case is `unsupported_value` for `reasoning.effort`.
- The rejected value corresponds to the effort actually attempted.
- A supported-values list can be extracted without ambiguity.
- At least one advertised value maps to a known logical thinking level that the SDK can send.
- A replacement differs from the rejected wire value, and another request remains in the budget.

Prefer structured error fields when available. The first implementation recognizes only the observed `unsupported_value` envelope for `reasoning.effort`, including its explicit rejected value and supported-values message. The SDK may wrap that JSON error in `errorMessage`. Keep this bounded parser at the provider boundary and fail closed for unknown envelopes. Do not treat arbitrary error prose as a command or infer a level from a generic HTTP 400.

Map wire values through the model's thinking-level mapping. For example, logical Off may map to wire `none`. Do not send a provider's arbitrary string as an SDK thinking level. If the format, parameter, mapping, or candidate list cannot be trusted, report the original sanitized error without probing.

Authentication failures, rate limits, network errors, unrelated invalid parameters, response truncation, and malformed summary content do not trigger thinking correction.

## Selecting the replacement

Use the existing order of logical thinking levels. Intersect the provider's advertised values with known, sendable mappings and remove the rejected wire value.

Choose the highest candidate at or below the requested level. If none exists, choose the lowest candidate. This preserves the preference for a lower effort where possible. For rejected Off with candidates Low through Max, it selects Low.

Both default Off and explicitly selected Off are eligible for this recovery. The existing picker represents a preference, not a separate prohibition on using thinking. The Warning makes the actual request level visible.

Do not hard-code `gpt-6.1-sol`, assume Low is universally supported, or equate a backend-accepted level with the best level for summary quality.

## Warning and visible state

Use the existing `ctx.ui.notify` API with severity `warning`. Emit the Warning immediately before the correction request, after checking cancellation and the request budget.

For Off-to-Low, use the message in the Decision section. For other corrections, use:

> Current summary model does not support thinking {rejected}. Retrying with {replacement}.

Name the level actually rejected, not necessarily the configured preference. For example, if a previously accepted Low override is later rejected while the requested preference remains Off, name Low in the Warning. Add "its lowest supported level" only when the selected replacement is the lowest mapped candidate. Do not claim that recovery has succeeded before receiving the retry result.

Emit one Warning per correction attempt, not one for every subsequent summary using an accepted level. No extra cost message or acknowledgement is required. A successful retry produces the normal card. A failed retry produces an error card with a sanitized cause.

When requested and effective values differ, `/context-hint status` should make that distinction visible. For example, it can report `thinking Low (requested Off; effective for this session)`. Do not imply that a runtime correction has been saved to project configuration.

## Request budget and repair

Keep the current maximum of two summary requests per generation. The second request can correct thinking or repair the summary format, but it cannot do both through additional requests.

| First result | Second request | Final handling |
| --- | --- | --- |
| Valid summary | None | Save the summary |
| Recognized unsupported thinking | Original prepared prompt with corrected thinking | Save a valid summary; otherwise report its error |
| Successful provider response, invalid summary | Existing repair prompt with the same effective thinking | Save a valid summary; otherwise report its error |
| Other provider error or cancellation | None | Report the error or cancellation |

A corrected response with invalid JSON does not get a third request. A format-repair request that rejects thinking does not get a third request either. Reuse the same evidence and prior state; never begin a new turn to retry.

## Remembering an accepted correction

The first version uses a session-local map. It does not write corrected values into project configuration, change the global model metadata, or overwrite the user's requested level.

Scope an entry to provider, API, endpoint identity, model ID, and requested thinking level. Use `baseUrl` from the resolved host model as the endpoint identity. If no stable endpoint identity is available, do not reuse a correction across requests. Keep endpoint identity in memory; do not persist credential-bearing URLs or headers. A correction for one model or endpoint must not affect another.

Remember the effective level only after a completed, non-error provider response establishes that the corrected parameter was accepted. Summary JSON validation is a separate check; invalid JSON does not mean that the thinking parameter was rejected. Do not learn from an aborted, truncated, stale, or failed request.

Discard an entry when it is explicitly rejected. Do not retry the same rejected wire value. Clear learned state on session/project changes, and invalidate the affected entry when the user changes summary model or thinking settings. Late results from an old session or settings snapshot must not update the map.

A new session may need to learn the correction again. Cross-session persistence is deliberately deferred so this change does not silently rewrite an explicit user preference. The authoritative capability declaration remains a separate issue to fix.

## Failure reporting and integration

`generateHint` should inspect provider failure metadata before `decodeHint`. It should own the two-request budget and choose either capability correction or format repair. The error parser and candidate selector should be small, independently testable transformations, not a new provider framework.

`runGeneration` should use its existing failure path when generation cannot produce a valid hint. Such a result must not be returned as an ordinary empty hint and persisted as `ready`. Keep previous valid session/project state unchanged when the attempt fails.

Use the existing error-card and notification APIs. Preserve a bounded, sanitized provider cause for the user, including a recognized error code and rejected parameter where available. Do not persist raw response bodies, prompts, thinking text, tool arguments, headers, credentials, or full endpoint URLs for this feature.

Check cancellation before sending either request and before notifying, learning a value, or committing state. Recovery must retain the existing generation/session identity checks.

## Acceptance checks

Implementation should add behavior tests for these cases:

1. Off is rejected with the observed error; one Warning appears, Low is sent on the second request, and a valid result becomes a normal ready card.
2. The same correction occurs under inherit and explicit selection of the same model.
3. The replacement comes from the advertised list, not a hard-coded Low fallback. A rejected Max can fall back to a supported lower level.
4. Unknown error prose, an unsupported mapping, or an empty candidate set produces a useful error without a speculative request or Warning.
5. Authentication, rate-limit, network, unrelated-parameter, truncation, and cancellation failures do not trigger thinking correction.
6. The corrected request fails or returns invalid content; no third request occurs, no failed-empty ready hint is saved, and previous valid state remains intact.
7. The format-repair path still works, shares the same two-request budget, and cannot restart correction after exhausting it.
8. Accepted corrections are reused within the session without repeated Warnings. Failed or stale attempts do not poison the learned state.
9. Provider, endpoint, model, requested-level, session, and user-setting changes prevent inappropriate reuse. Project/global configuration remains unchanged.
10. Warning text names the rejected and replacement levels, claims no success before the retry, and adds no separate cost reminder or confirmation.
11. Error sanitization removes synthetic secrets and credential-bearing URLs while retaining a useful failure category.

After those tests pass, verify the implemented extension in a fresh Git project through the actual Pi TUI. Keep the main and summary model fixed, compare inherit/explicit Off, and confirm the Warning appears before the corrected request and the card is usable. This future verification must exercise the real implementation rather than the earlier scratch observer.

## Review status

The Warning interaction follows the agreed user requirement. Session-only learning and the shared two-request budget are proposed first-version defaults. No implementation, persistent schema change, or production configuration change is included in this document.
