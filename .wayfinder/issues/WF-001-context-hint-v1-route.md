---
id: WF-001
title: Chart Context Hint v1 route
state: closed
labels:
  - wayfinder:map
assignee: implementer
resolved_at: 2026-09-14
parent:
blocked_by: []
---

## Destination

A working Pi-only Context Hint v1 in this repository that preserves the existing card renderer and visual design, generates persistent human-facing Project / Session / Turn hints after `agent_settled`, and satisfies the stated configuration, background lifecycle, recovery, and reset acceptance flow.

## Notes

- Domain: Pi Agent extension; consult `grilling`, `domain-modeling`, `ponytail`, and installed Pi extension/TUI docs each session.
- Existing asset to preserve: `.pi/extensions/context-hint-demo.ts`, especially its bordered card renderer, width handling, theme use, `appendEntry`, and `registerEntryRenderer` path.
- Current Pi API facts: `agent_settled` exists; `appendEntry` is append-only and returns no id; `registerEntryRenderer` receives no TUI invalidation handle; `ctx.modelRegistry.complete`, `ctx.scopedModels`, session ids/files, tool lifecycle events, and session lifecycle events exist.
- Standing choice: use one visible loading entry plus sidecar/runtime generation state; trigger redraw through a no-content status tick rather than append a second visible final card.
- Standing choice: `/fork` and `/clone` inherit a SessionState snapshot, then evolve independently; `/new` starts empty.
- Standing choice: summary input uses bounded hard facts, not full unbounded tool output.
- Standing choice: explicit model picker uses `ctx.scopedModels` when non-empty, otherwise `modelRegistry.getAvailable()`.
- Config/state should live under Pi agent data, keyed by canonical project identity, not inside the git working tree.
- Default remains disabled. Context Hint stays a TUI-only custom entry and never enters future LLM context by default.
- This effort explicitly carries implementation toward the destination once decision tickets clear; do not add cross-harness adapters, daemon/RPC layers, embeddings, search, cloud sync, dashboard, or long-term user memory.

## Decisions so far

- [Define branch-aware session lineage](./WF-002-define-branch-aware-session-lineage.md) — Active-branch entries are authoritative; fork/clone inherit immutable snapshots and then diverge.
- [Validate single-entry loading lifecycle](./WF-003-validate-single-entry-loading-lifecycle.md) — One append-only card redraws from sidecar/runtime state via a no-content status tick.
- [Set durable project knowledge rules](./WF-004-set-durable-project-knowledge-rules.md) — Git common-dir identity shares durable state across worktrees; evidence gates updates.
- [Set evidence retention and redaction policy](./WF-005-set-evidence-retention-and-redaction-policy.md) — Persist only bounded redacted facts needed for hints and regenerate.
- [Define persistence and recovery semantics](./WF-007-define-persistence-and-recovery-semantics.md) — Atomic Pi-agent sidecars, quarantine, lock, epoch, and immutable generations.
- [Finalize minimal implementation slice](./WF-008-finalize-minimal-implementation-slice.md) — One extension plus one core module and focused runnable checks.
- [Choose cross-model structured output contract](./WF-006-choose-cross-model-structured-output-contract.md) — Use one validated provider-neutral tool envelope with best-effort strict sampling and one same-model repair attempt.

## Deferred beyond v1

- Migration behavior beyond `schemaVersion: 1`; add only when a second schema exists.
- Manual interactive matrix across every configured provider/model family; automated checks cover lifecycle/state contracts and real Pi loading.

## Out of scope

- Claude Code, Codex, OpenCode, or other harness adapters.
- Independent daemon, RPC service, adapter registry, vector database, embeddings, semantic search, cross-machine sync, cloud account, central dashboard, long-term user memory, or attention scheduler.
- Rewriting the existing Context Hint visual language without evidence that its renderer cannot support required states.

## Resolution

Delivered Pi-only Context Hint v1. Default is disabled; `/context-hint enable` activates post-`agent_settled` generation. One TUI-only append entry animates and resolves in place from sidecar state. Branch-aware Session Context, worktree-shared Project Context, bounded/redacted Turn Evidence, provider-neutral validated structured output with one same-model JSON repair, atomic recovery, regenerate, model picker, disable, and confirmed session/project reset are implemented. Tests, typecheck, build, Pi auto-load, and two-axis review passed after fixing immutable regenerate lineage, fork-pending recovery, and JSON rescue.
