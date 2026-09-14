---
id: WF-006
title: Choose cross-model structured output contract
state: closed
labels:
  - wayfinder:research
assignee: researcher
resolved_at: 2026-09-13
resolution_commit: b9905c8
parent: WF-001
blocked_by: []
research_branch: research/context-hint-structured-output
research_path: docs/research/context-hint-structured-output.md
---

## Question

Using Pi's current model registry and provider APIs, what smallest structured-output contract works across scoped available models for `turnDelta`, `sessionPatch`, optional `projectPatch`, and `attentionCue`, including strict schema/tool support, plain-JSON fallback, validation, and one repair retry?

## Resolution

Use one provider-neutral `context_hint_v1` tool-call envelope with exactly the agreed field-wise patch schema. Resolve one configured summary model (inherit-current or explicit), use provider-specific tool forcing where available, request `constrainedSampling: { type: "json_schema", strict: "prefer" }`, and validate all normalized arguments locally before reducer writes. Pi v0.85.1 cannot strictly constrain the exact envelope because its strict normalizer rejects the object/array unions produced by optional array fields and `projectPatch: null | object`; `strict: "require"` must not be used. On a recoverable contract failure, retry once with the same model and a compact repair prompt, disabling constrained sampling if it caused provider rejection and falling back to ordinary forced tool calling or strict JSON text. After that retry, return an error and mutate no state—do not silently switch summary models.

Research asset: [Context Hint v1 cross-model structured output contract](../../../research-structured-output/docs/research/context-hint-structured-output.md) on `research/context-hint-structured-output` at `b9905c8`.
