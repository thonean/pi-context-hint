---
id: WF-009
title: Package Context Hint as a GitHub and Pi package
state: closed
labels:
  - wayfinder:map
assignee: implementer
resolved_at: 2026-09-16
parent:
blocked_by: []
---

## Destination

A normal, maintainable GitHub repository for Context Hint: clear source/test layout, runnable tests and type checks, reproducible build, CI, README and license, plus an npm tarball that installs and loads as a Pi package. Actual npm publication happens later.

## Notes

- Domain: Pi extension and npm package; consult `grilling`, `domain-modeling`, `ponytail`, and current Pi package/extension docs each session.
- Preserve behavior already delivered by [Chart Context Hint v1 route](./WF-001-context-hint-v1-route.md); this effort reorganizes and packages it rather than redesigning Context Hint.
- User wants the full normal-repo baseline: source layout, test module, README, build, package metadata, CI, license, and publish-readiness checks.
- Prefer existing Bun tests and platform tooling. Add dependencies only where the repository cannot supply the required check itself.
- Use placeholder package/repository/author metadata for now. Keep accidental publication blocked and maintain an explicit pre-publish replacement checklist.
- This effort carries implementation into the final ticket once decisions clear. Keep change minimal and avoid unrelated feature work.

## Decisions so far

- [Choose package layout and public surface](./WF-010-choose-package-layout-and-public-surface.md) — Build one `dist/context-hint.js` Pi entry from conventional extension/core source, with no old-path shim or public core API.
- [Verify Pi and npm package contract](./WF-011-verify-pi-and-npm-package-contract.md) — Publish explicit manifest-targeted output, externalize Pi host peers, inspect the tarball, then clean-install and Pi-load it.
- [Define test, typecheck, and build contract](./WF-012-define-test-typecheck-and-build-contract.md) — Use Bun tests, strict `tsc`, one Bun bundle, and a single `check` command that also previews the npm tarball.
- [Design README and package identity](./WF-014-design-readme-and-package-identity.md) — Lead with product use, move developer workflow to `CONTRIBUTING.md`, and keep placeholder metadata private until publication.
- [Define publish-readiness gate](./WF-015-define-publish-readiness-gate.md) — Keep fast PR checks separate from strict placeholder, tarball, clean-install, and manual Pi release validation.
- [Restore local Git command access](./WF-017-restore-local-git-command-access.md) — Apple Git 2.54.0 can inspect this repository again, clearing the GitHub-baseline prerequisite.
- [Set GitHub repository baseline](./WF-013-set-github-repository-baseline.md) — Use MIT, minimal repository docs, one read-only Bun CI workflow, and no premature community or release automation.
- [Finalize minimal repository normalization](./WF-016-finalize-minimal-repository-normalization.md) — Normalize source/tests/package/CI/docs and tarball checks without changing product behavior or adding release machinery.

## Not yet specified

None.

## Out of scope

- Publishing to npm, creating npm credentials or provenance, and choosing final public namespace/version.
- Package-gallery media and presentation assets; revisit with final public identity in the publication effort.
- Creating or administering the remote GitHub repository, branch protection, secrets, or npm release permissions.
- New Context Hint product features, renderer redesign, cross-harness support, or architecture refactors unrelated to packaging.

## Resolution

Delivered the normalized GitHub/npm/Pi package repository. Source and tests now use conventional directories; Bun tests, strict TypeScript checking, single-file build, npm tarball preview, exact tarball allowlist, clean install, and Pi entry loading pass. Product README, CONTRIBUTING guide, MIT license, minimal read-only CI, private placeholder metadata, and release guards are in place. Actual remote creation and npm publication remain a separate future effort.
