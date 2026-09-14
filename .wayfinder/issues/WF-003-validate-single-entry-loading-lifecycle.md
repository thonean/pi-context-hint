---
id: WF-003
title: Validate single-entry loading lifecycle
state: closed
labels:
  - wayfinder:prototype
assignee: implementer
resolved_at: 2026-09-14
parent: WF-001
blocked_by: []
---

## Question

Can the existing custom entry renderer support a visibly animated loading → ready/error transition in the original transcript position, using one visible append-only entry, sidecar/runtime state keyed by generation id, and an invisible `ctx.ui.setStatus` redraw tick—while remaining correct after reload, rapid next-turn input, and session switching?

## Resolution

Validated one append-only visible custom entry. Renderer reads generation sidecar/runtime state by generation id, loading animation advances in memory, and empty `ctx.ui.setStatus` set/clear calls trigger transcript redraw. Ready/error replace loading in the original transcript position. Reload restores sidecars; interrupted or fork-inherited pending records render error instead of hanging; session shutdown/tree navigation abort active generation.
