---
id: WF-008
title: Finalize minimal implementation slice
state: closed
labels:
  - wayfinder:grilling
assignee: implementer
resolved_at: 2026-09-14
parent: WF-001
blocked_by:
  - WF-002
  - WF-003
  - WF-004
  - WF-005
  - WF-006
  - WF-007
---

## Question

Given the resolved Pi lifecycle, state lineage, project durability, evidence, structured-output, and persistence decisions, what is the smallest module boundary, implementation sequence, and runnable validation contract that reaches the full v1 acceptance flow while reusing `.pi/extensions/context-hint-demo.ts` and avoiding speculative abstractions?

## Resolution

Implemented two runtime modules: `.pi/extensions/context-hint-demo.ts` owns Pi hooks, model calls, commands, and preserved card renderer; `.pi/context-hint/core.ts` owns small pure reducers, validation, redaction, and atomic sidecars. Runnable contract: Bun behavior tests for reducers/persistence/lineage/renderer states, strict TypeScript check, Bun build, and real Pi extension auto-load. No package, daemon, adapter, search, embeddings, or dashboard layer added.
