---
id: WF-002
title: Define branch-aware session lineage
state: closed
labels:
  - wayfinder:grilling
assignee: implementer
resolved_at: 2026-09-14
parent: WF-001
blocked_by: []
---

## Question

What exact state lineage should ProjectState, SessionState, saved TurnEvidence, and generated hints follow across `/new`, `/resume`, `/fork`, `/clone`, `/tree`, `/reload`, retries, compaction, and a summary that finishes after session replacement, so each branch resumes the correct rolling state without cross-session contamination?

## Resolution

Session Context is reconstructed only from Context Hint custom entries on the active Pi branch. `/tree` follows that branch; `/resume` reloads its session file; `/fork` and `/clone` inherit immutable hint snapshots copied into the new file, then diverge through new generation ids; `/new` has no hint entries and starts empty. Compaction and retries do not create hints because generation waits for `agent_settled`. Reload/restart converts inherited pending cards to local errors. Session replacement aborts old jobs, and every completion checks the active session id before mutation.
