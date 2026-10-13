<p align="center"><img src="https://cdn.jsdelivr.net/npm/pi-context-hint@0.1.1/assets/context-hint-logo.svg" alt="Context Hint pixel eye logo" width="120"></p>

<h1 align="center">Context Hint for Pi</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/pi-context-hint"><img src="https://img.shields.io/npm/v/pi-context-hint?logo=npm" alt="npm version"></a>
  <a href="https://cdn.jsdelivr.net/npm/pi-context-hint/LICENSE"><img src="https://img.shields.io/npm/l/pi-context-hint" alt="MIT license"></a>
  <a href="https://pi.dev/packages/pi-context-hint"><img src="https://img.shields.io/badge/Pi-extension-7c3aed" alt="Pi extension"></a>
</p>

**Pick up a Pi session without rereading its transcript.** Context Hint adds a compact Project, Session, and Turn card after each settled interaction. The card shows the project's purpose, session goal, recent change, and possible next step.

Context Hint helps when you switch between projects, worktrees, and Pi sessions. Read the latest card instead of reconstructing the previous session from its transcript.

## Demo

<p align="center">
  <img src="https://github.com/thonean/pi-context-hint-media/raw/main/context-hint-demo-cropped.gif" alt="Animated preview of a fictional Context Hint card" width="240">
</p>

## A typical switch

Imagine an API fix in one worktree and a UI change in another. Leave the API session while work continues, switch to the UI, then return. Instead of reconstructing the API thread from earlier messages, read its last Context Hint card to see what changed and what might come next.

The card is a **human-facing recovery cue**. It does not monitor other agents or alert you when they finish. It appears in each enabled Pi session after an interaction settles. Earlier cards remain in that session's transcript. Press `alt+o` to expand or collapse them.

## Try it

Context Hint is a [Pi coding agent](https://pi.dev/) TUI extension. It requires Pi 1.1.0 or later. Install the published package with Pi:

```bash
pi install npm:pi-context-hint
```

In an existing Pi session, run `/reload` after installation. Bun is only needed when you run the extension from a local checkout.

Generation starts **disabled**. Enabling it sends selected interaction evidence and previous Project / Session state to a summary model after each settled turn, normally in one extra request. [See model use, token cost, and context](#model-use-token-cost-and-context). In Pi, run:

```text
/context-hint enable
```

Continue working normally. After the next settled interaction, a Context Hint card appears. Use `/context-hint model` if you want a dedicated summary model instead of Pi's current model.

To run it from a local checkout during development:

```bash
bun install
bun run build
pi -e ./dist/context-hint.js
```

## What the three layers mean

| Layer | What it helps you recover | Where it follows you |
| --- | --- | --- |
| **Project** | Durable purpose, constraints, and decisions | Shared across sessions and Git worktrees of the same repository |
| **Session** | Current goal, focus, blockers, and next steps | Follows the active Pi session branch; forks and clones inherit a snapshot, then diverge |
| **Turn** | What was accomplished or learned in the settled interaction | Shown in that interaction's card |

A new Pi session starts without the previous session's rolling Session Context. Project Context remains available for that repository. Different repositories have separate Project Context. Turn summaries use selected evidence from the current interaction, not a replay of the full conversation.

## Commands

| Command | Purpose |
| --- | --- |
| `/context-hint` | Open the command menu |
| `/context-hint status` | Show current configuration |
| `/context-hint enable` or `/context-hint disable` | Start or stop future generation. Disabling keeps existing state. |
| `/context-hint model` | Choose a summary model and adjust its independent thinking level, or inherit Pi's current model |
| `/context-hint regenerate` | Regenerate the latest settled hint |
| `/context-hint toggle` or `alt+o` | Expand or collapse cards |
| `/context-hint motion reduce` or `/context-hint motion animate` | Disable or enable spinner and eye animation |
| `/context-hint reset-session` | Reset rolling Session Context |
| `/context-hint reset-project` | Reset durable Project Context for this project |

## Model use, token cost, and context

**This uses an extra model request, not free local summarization.** When enabled in a Pi TUI, a settled interaction normally makes one request to the selected summary model. If its response fails validation, Context Hint can make one repair request to the same model. Both requests use the summary model's configured thinking level. Manual regeneration also requests a new summary. By default the extension inherits Pi's current model, but not Pi's thinking level: summary thinking defaults to `off` when supported, otherwise the model's lowest supported level. Use `/context-hint model` to select an available, lower-cost model or independently adjust its thinking level with ←/→; ↑/↓ changes model, Enter saves, and Esc discards changes. Models without thinking support show that status instead of a slider. Pi model metadata determines which thinking levels the picker lists; Context Hint does not test provider API support. Levels are persisted per project and `provider/model`, and only supported levels are shown. If a saved level becomes unsupported, the picker warns and shows the highest supported level at or below it, or the lowest supported level if none is lower; fallback is saved only on Enter. There is no automatic fallback to another model.

**Input is selected and truncated, not the full transcript.** Evidence can include up to 4,000 characters of the current user prompt, 6,000 combined characters of assistant text, the first 24 tool facts (each with truncated input and text output), and short excerpts of `CONTEXT.md`, `README.md`, and `package.json` when present. Previous Project and Session state is also included. The serialized generation prompt is truncated to 20,000 JavaScript string units; the validation-repair request adds instructions. Each request sets `maxTokens: 3,500` for output. These are character/item limits on input and a requested output-token limit, **not a strict input-token or billing ceiling**.

For a rough English-language illustration: if the *assembled* prompt for one turn is about 8,000 characters, it might be around 2,000 input tokens, plus system instructions and tool schema; a short result might use a few hundred output tokens. A near-20,000-character prompt might instead be on the order of 5,000 English input tokens before that overhead. Code, non-English text, model tokenizers, and a possible second repair request change the numbers. Context Hint does not record token usage or cost, so these examples are **not measured usage or a price estimate**. Your provider's usage data is the source for actual cost.

Cards are custom transcript entries for **you**. Their rendered text is not automatically inserted into ordinary later agent prompts. Summary generation sends the previous Project and Session state and selected current-turn evidence to the chosen model so it can update the card. Context Hint avoids replaying entire transcripts into ordinary future model context. It still consumes tokens and shares data with the summary model on each generation.

## Data and privacy

Context Hint stores settings and per-project state under Pi's agent data directory (`context-hint/settings.json` and `context-hint/projects/<project-id>/`), outside the repository. Generation records contain selected evidence, generated hints, and state snapshots. They are local files, **not encrypted by this extension**; historical generation records are not automatically pruned. Resetting Session or Project Context does **not** delete those historical records.

Before sending a prompt to the chosen model, Context Hint applies pattern-based redaction for some recognizable keys, tokens, and private-key blocks, then truncates the evidence. This can miss secrets. Model-generated fields are validated against a schema but are **not redacted again before storage**. Do not rely on this extension to protect data that must not reach the selected model or remain in local records. Pi extensions run with full system access; review source before installing.

## Troubleshooting

- No card appears: run `/context-hint status` and confirm generation is enabled; cards are generated after settled interactions in the Pi TUI.
- No model is selected or the configured model is unavailable: run `/context-hint model`.
- Latest generation failed: run `/context-hint regenerate` after a settled interaction.
- Context is stale: reset Session Context first; reset Project Context only if durable project knowledge needs clearing. Resets do not erase historical generation records.

## Contributing

Development setup, tests, type checking, build, packaging, and the manual Pi smoke checklist live in the [repository's contribution guide](https://github.com/thonean/pi-context-hint/blob/main/CONTRIBUTING.md). You need repository access while the source repository is private.

## License

MIT. See [`LICENSE`](./LICENSE).
