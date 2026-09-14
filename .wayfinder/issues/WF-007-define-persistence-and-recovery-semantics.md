---
id: WF-007
title: Define persistence and recovery semantics
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
---

## Question

What atomic sidecar layout and recovery rules should persist config, ProjectState, branch-aware SessionState, generation records, and latest TurnEvidence—including malformed files, interrupted loading jobs, concurrent project patches, regenerate, disable/re-enable, session reset, and project reset?

## Resolution

State lives under `~/.pi/agent/context-hint/projects/<canonical-project-hash>/`: `config.json`, `project.json`, and immutable generation JSON files. JSON writes use mode-0600 temporary files, fsync, and atomic rename. Malformed files are quarantined with `.corrupt-<timestamp>` and safe defaults/errors are used. Project updates use a lock directory and epoch/revision fields; interrupted pending work becomes error; regenerate appends a new immutable generation; disable preserves state; session reset appends a branch-local reset marker; project reset clears durable state and advances epoch.
