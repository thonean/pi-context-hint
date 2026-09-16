---
id: WF-014
title: Design README and package identity
state: closed
labels:
  - wayfinder:prototype
assignee: implementer
resolved_at: 2026-09-16
parent: WF-009
blocked_by:
  - WF-010
  - WF-011
---

## Question

What README structure, install/configure/use examples, package description, keywords, and placeholder metadata make Context Hint understandable and testable by a first-time Pi user while clearly marking values that must be replaced before publication?

## Resolution

Make README product-first: what Context Hint does, installation, first-card flow, command table, context behavior, data/privacy, troubleshooting, contribution link, and license. Put setup, testing, typecheck, build, and packaging details in a separate `CONTRIBUTING.md`. Use the placeholder identity `@your-scope/pi-context-hint`, version `0.0.0-development`, placeholder repository/author fields, and `private: true`; publication stays blocked until every placeholder and the private guard are deliberately replaced. License is governed by [Set GitHub repository baseline](./WF-013-set-github-repository-baseline.md). Validated prototype: [README and package identity draft](../prototypes/readme-and-package-identity-draft.md).
