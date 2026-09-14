---
id: WF-004
title: Set durable project knowledge rules
state: closed
labels:
  - wayfinder:grilling
assignee: implementer
resolved_at: 2026-09-14
parent: WF-001
blocked_by: []
---

## Question

What evidence is strong enough to update slow-changing ProjectState, how is project identity scoped across nested cwd and git worktrees, and how should concurrent session patches merge so durable architecture, constraints, conventions, decisions, and phase changes are preserved without turning ProjectState into a turn log?

## Resolution

Canonical project identity is the real path of `git rev-parse --git-common-dir`, so linked worktrees share Project Context; non-git projects use a marker-based real directory root. Project Patch applies only when initializing from project facts, changing durable project documents, or handling an explicit durable-decision prompt. Writes are serialized by a short-lived lock and merge array facts by value; project reset increments an epoch so stale jobs cannot repopulate cleared state.
