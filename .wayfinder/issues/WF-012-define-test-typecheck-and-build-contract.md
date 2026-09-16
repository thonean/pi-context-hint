---
id: WF-012
title: Define test, typecheck, and build contract
state: closed
labels:
  - wayfinder:grilling
assignee: implementer
resolved_at: 2026-09-16
parent: WF-009
blocked_by:
  - WF-010
  - WF-011
---

## Question

Given the chosen source layout and Pi package constraints, what minimal commands and test organization must reliably validate core behavior, extension behavior, TypeScript correctness, production build output, and packed-package loading locally and in CI?

## Resolution

Use Bun as the only supported CI runtime for now. Move tests to `test/**/*.test.ts` and keep `bun:test`; expose single-file runs through `bun test test/<file>.test.ts`. Add strict `tsc --noEmit` for type checking and Bun's built-in bundler for the single `dist/context-hint.js` production output. Define one local/CI `check` command that runs tests, typecheck, build, and `npm pack --dry-run`; leave clean tarball installation and real Pi loading to the later publish-readiness gate. Pin Bun through the repository's lockfile/CI setup rather than adding a runtime matrix before compatibility evidence exists.
