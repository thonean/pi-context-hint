---
id: WF-005
title: Set evidence retention and redaction policy
state: closed
labels:
  - wayfinder:grilling
assignee: implementer
resolved_at: 2026-09-14
parent: WF-001
blocked_by: []
---

## Question

Which deterministic turn facts and bounded result excerpts may enter SummaryInput and saved TurnEvidence, what truncation and secret-redaction rules apply, and how long must evidence remain available to support regenerate without retaining unnecessary transcript or credential material?

## Resolution

Turn Evidence retains bounded redacted user text, assistant text, up to 24 bounded tool facts, verified tool argument paths, image count, and bounded excerpts from `CONTEXT.md`, `README.md`, and `package.json`. Common bearer tokens, API keys, passwords, secrets, GitHub/Slack/OpenAI token shapes, and private keys are redacted before persistence. Full tool output and images are not saved. Evidence lives only in per-generation sidecars under Pi agent data and remains available for regenerate until users remove Context Hint project data.
