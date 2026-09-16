---
id: WF-013
title: Set GitHub repository baseline
state: closed
labels:
  - wayfinder:grilling
assignee: implementer
resolved_at: 2026-09-16
parent: WF-009
blocked_by:
  - WF-012
  - WF-017
---

## Question

Which repository-level files and GitHub automation are required for this project now—ignore rules, license, contribution/security metadata, CI triggers and runtime matrix—and which common files would be ceremony without current value?

## Resolution

Use the MIT License now. Repository baseline is `README.md`, `CONTRIBUTING.md`, `LICENSE`, `.gitignore`, committed Bun lockfile, package/build configuration, and one `.github/workflows/ci.yml`. CI runs on every push and pull request with read-only contents permission, installs from the frozen Bun lockfile, and executes `bun run check` on one supported Bun version. Control npm contents through `package.json.files`; do not add `.npmignore`. Skip SECURITY, issue/PR templates, code of conduct, CODEOWNERS, Dependabot, and release automation until real maintainers, reporting channels, community load, or publishing credentials create that need.
