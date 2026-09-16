---
id: WF-011
title: Verify Pi and npm package contract
state: closed
labels:
  - wayfinder:research
assignee: researcher
resolved_at: 2026-09-16
parent: WF-009
blocked_by: []
---

## Question

Using current Pi package and extension documentation plus npm packaging behavior, what manifest fields, directory conventions, peer dependency rules, build output, tarball contents, and clean-install smoke checks are required for Context Hint to publish and load correctly without bundling Pi core packages?

## Resolution

Use an explicit `package.json.pi` manifest whose paths exist in the packed tarball. Declare Pi host imports as `peerDependencies: "*"` and externalize them; keep other runtime imports in `dependencies`. Pi can load TypeScript through jiti, but built JavaScript is the lower-risk published entrypoint when the tarball must not depend on development tooling. Control tarball contents with `files`, inspect them with `npm pack --dry-run`, then install the produced tarball without dev dependencies and smoke-load it through Pi. Full evidence and source citations: [Verify Pi and npm package contract research](../research/verify-pi-and-npm-package-contract.md).
