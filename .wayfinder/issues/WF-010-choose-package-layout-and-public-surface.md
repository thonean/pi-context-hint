---
id: WF-010
title: Choose package layout and public surface
state: closed
labels:
  - wayfinder:grilling
assignee: implementer
resolved_at: 2026-09-16
parent: WF-009
blocked_by: []
---

## Question

What smallest conventional repository layout should replace the current `.pi/` prototype layout, which files are public package resources versus internal source, and what compatibility path—if any—must remain for existing local Pi use?

## Resolution

Use `extensions/context-hint.ts` as the Pi-facing source entry, `src/core.ts` for internal logic, and `test/*.test.ts` for tests. Build them into one published `dist/context-hint.js` entry and point the Pi manifest at that file. Remove the old `.pi/` implementation paths without a compatibility shim or duplicate source. The npm package exposes only the Pi extension, not an importable core API. Its tarball contains runtime build output plus `package.json`, README, and license; source, tests, Wayfinder artifacts, and repository-only files stay out.
