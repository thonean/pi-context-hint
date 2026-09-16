---
id: WF-015
title: Define publish-readiness gate
state: closed
labels:
  - wayfinder:grilling
assignee: implementer
resolved_at: 2026-09-16
parent: WF-009
blocked_by:
  - WF-012
  - WF-014
---

## Question

What exact pre-publish gate should prove the npm tarball contains only intended files, installs in a clean environment, loads in Pi, exposes correct metadata, and cannot be accidentally published while placeholder identity fields remain?

## Resolution

Use two layers. Every PR runs `bun run check`; release preparation runs stricter `bun run release:check` plus a local Pi TUI smoke checklist. Keep `private: true` as the current hard publication block, add an automated release scan that rejects placeholder package identity, repository URLs, author, version, and license, and wire the same gate to `prepublishOnly`. The release script builds a real tarball, verifies an exact file allowlist, installs it in a temporary directory with dev dependencies omitted, and confirms the Pi manifest target exists after installation. Final human smoke: install that packed artifact, start Pi with it, inspect `/context-hint`, enable it, settle one interaction, and confirm the card renders. CI does not receive model credentials or perform real model interaction.
