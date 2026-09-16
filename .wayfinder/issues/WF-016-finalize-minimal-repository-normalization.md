---
id: WF-016
title: Finalize minimal repository normalization
state: closed
labels:
  - wayfinder:grilling
assignee: implementer
resolved_at: 2026-09-16
parent: WF-009
blocked_by:
  - WF-013
  - WF-015
---

## Question

With layout, package rules, verification, GitHub baseline, documentation, and publication gate settled, what smallest ordered change set reaches the destination, and can it be implemented and verified without feature changes or speculative release machinery?

## Resolution

Normalized the repository without changing Context Hint product behavior. Moved runtime and tests to `src/`, `extensions/`, and `test/`; added Bun/TypeScript package metadata and lockfile; bundled one ESM `dist/context-hint.js` entry with Pi host peers externalized; added product-first README, CONTRIBUTING workflow, MIT license, ignore rules, and read-only push/PR CI. Added focused metadata/tarball validation with clean npm installation and Pi manifest-target checks. Removed scout-generated root context/research files and old `.pi/` implementation paths. `bun run check` and `bun run package:smoke` pass; `bun run release:check` intentionally fails on placeholder/private publication metadata. No remote, publish, release workflow, compatibility shim, or public core API added.
