# Contributing

## Requirements

- Bun 1.3.13 or newer
- Node 22.19 or newer
- npm for package checks and publishing
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

`bun run check` runs the full test suite, strict TypeScript checking, the production build, and `npm pack --dry-run`. GitHub Actions runs this command for every pull request. The required `check` status must pass before GitHub allows a merge into `main`.

## Package checks

`bun run package:smoke` builds a real npm tarball, checks its exact allowlist, installs it in a temporary directory without dev dependencies, and verifies the installed Pi manifest target.

`bun run release:check` reruns the full repository checks, then performs the strict tarball checks. It rejects placeholder publication metadata and `private: true`.

Tarballs built from this checkout include the extension, README, license, logo, and static preview. They exclude demo MP4 and GIF files. The published package excludes demo MP4 and GIF files. The README GIF loads from the separate public [`pi-context-hint-media` repository](https://github.com/thonean/pi-context-hint-media). Keep demo media outside the npm file allowlist.

## Manual Pi smoke test

Before publishing a new version:

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

Review publication metadata and the packed tarball:

- Keep the package name `pi-context-hint`.
- Confirm repository, homepage, author, and issue URLs.
- Choose a version that has not been published to npm.
- Update the versioned CDN preview URL in `pi.image`.
- Keep `private` unset or `false` for intentional public releases.
- Confirm the MIT license and `pi install npm:pi-context-hint` command.
- Run `bun run release:check`.
- Complete the manual Pi smoke test.

Do not publish from an unreviewed working tree.

## Regenerate the repository GIF

Run this command from the repository root to rebuild the repository GIF from `assets/context-hint-demo.mp4`. It preserves the full 18-second duration and portrait ratio at 720 × 1,280:

```bash
ffmpeg -y -hide_banner -loglevel error -i assets/context-hint-demo.mp4 \
  -filter_complex "[0:v]fps=6,scale=720:1280:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128:reserve_transparent=0[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" \
  -loop 0 assets/context-hint-demo.gif
```

Keep video and GIF media in the repository for source previews. Do not add them to the npm file allowlist.
