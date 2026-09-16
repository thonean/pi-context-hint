# Context Hint for Pi

Persistent Project, Session, and Turn context cards for the [Pi coding agent](https://pi.dev/).

Context Hint generates a compact card after each settled interaction. Current goal, durable project knowledge, recent work, blockers, and next step remain visible without being injected into future model context.

> This package still uses placeholder identity and remains private. Do not publish it until the checklist in `CONTRIBUTING.md` is complete.

## What it does

- Keeps Project Context across sessions and worktrees of one repository
- Keeps branch-aware Session Context across resume, fork, and clone flows
- Summarizes each settled turn from bounded, redacted evidence
- Shows loading, ready, and error states in one transcript card
- Lets you choose the generation model or regenerate the latest hint
- Starts disabled and stores no runtime state inside the repository

## Install

The npm identity is intentionally a placeholder until publication:

```bash
pi install npm:@your-scope/pi-context-hint
```

For now, try a local checkout:

```bash
bun install
bun run build
pi -e ./dist/context-hint.js
```

## Get your first Context Hint

Enable the extension:

```text
/context-hint enable
```

Continue working normally. After the next settled interaction, Context Hint adds a card containing Project, Session, and Turn context.

Use `ctrl+o` to expand or collapse a completed card.

## Commands

| Command | Purpose |
| --- | --- |
| `/context-hint` | Show current configuration |
| `/context-hint enable` | Enable future Context Hint cards |
| `/context-hint disable` | Disable generation while keeping existing state |
| `/context-hint model` | Choose the generation model |
| `/context-hint regenerate` | Regenerate the latest settled hint |
| `/context-hint reset-session` | Reset rolling Session Context |
| `/context-hint reset-project` | Reset durable Project Context for this project |

## How context behaves

**Project Context** uses canonical Git project identity, so worktrees share durable knowledge.

**Session Context** follows the active Pi branch. Forked and cloned sessions inherit a snapshot, then evolve independently. New sessions begin without Session Context.

**Turn Context** uses bounded facts from the settled interaction. Failed tool calls cannot introduce code-path evidence.

## Data and privacy

Context Hint stores bounded, redacted generation records under Pi agent data. Runtime state stays outside the repository. Cards are custom TUI entries and do not enter future model context by default.

Pi packages execute with full system access. Review source before installation.

## Troubleshooting

- No card appears: run `/context-hint` and confirm the extension is enabled.
- No model is selected: run `/context-hint model`.
- Latest generation failed: run `/context-hint regenerate` after a settled interaction.
- Context is stale: reset Session Context first; reset Project Context only when durable project knowledge must be cleared.

## Contributing

Development setup, tests, type checking, build, packaging, and the manual Pi smoke checklist live in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

MIT. See [`LICENSE`](./LICENSE).
