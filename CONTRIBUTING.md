# Contributing

## Requirements

- Bun 1.3.13 or newer
- Node 22.19 or newer
- npm (used only for tarball checks)
- Pi for manual package smoke testing

## Setup

```bash
bun install --frozen-lockfile
```

## Checks

Run focused tests while working:

```bash
bun test test/core.test.ts
bun test test/extension.test.ts
```

Run full repository validation:

```bash
bun test
bun run typecheck
bun run build
bun run check
```

`bun run check` runs the full test suite, strict TypeScript checking, the production build, and `npm pack --dry-run`.

## Package checks

`bun run package:smoke` builds a real npm tarball, checks its exact allowlist, installs it in a temporary directory without dev dependencies, and verifies the installed Pi manifest target.

`bun run release:check` reruns the full repository checks, then performs the strict tarball checks and rejects the current placeholder package identity or `private: true`. It is expected to fail until publication metadata is deliberately replaced.

## Manual Pi smoke test

After package identity is ready for publication:

1. Run `bun run release:check`.
2. Install the packed artifact into a disposable Pi environment.
3. Start Pi with the package loaded.
4. Run `/context-hint` and confirm status appears.
5. Run `/context-hint enable`.
6. Settle one interaction and confirm one Context Hint card renders.
7. Expand and collapse the card with `alt+o`, then restart Pi and confirm the display state persists.
8. Run `/context-hint motion reduce` and confirm spinner and eye animation stop; restore them with `/context-hint motion animate`.
9. Run `/context-hint regenerate` and confirm the replacement card resolves.
10. Confirm `/context-hint reset-session` and `/context-hint reset-project` still require confirmation.

Do not add model credentials to CI. Real model interaction belongs in this local check.

## Before publishing

Replace every placeholder and review the packed tarball before removing the publication guard:

- `name`: replace `@your-scope/pi-context-hint`
- `repository.url`, `homepage`, and `bugs.url`: replace `your-org/pi-context-hint`
- `author`: replace `YOUR_NAME`
- `version`: replace `0.0.0-development`
- `private`: change `true` only when publication is intentional
- Confirm MIT license and final README install command
- Run `bun run release:check`
- Complete manual Pi smoke test

Do not publish from an unreviewed working tree.
