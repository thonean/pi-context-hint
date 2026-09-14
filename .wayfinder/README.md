# Local Markdown Tracker

This repository has no configured remote issue tracker. Wayfinder uses these files as its local issue tracker.

## Issue format

Each issue lives in `issues/<id>-<slug>.md` with YAML fields:

- `id`: stable issue identity
- `title`: human-readable issue name
- `state`: `open` or `closed`
- `labels`: tracker labels
- `assignee`: empty means unclaimed
- `parent`: parent map id for child tickets
- `blocked_by`: issue ids that must close first

## Wayfinding operations

- **Map:** issue labelled `wayfinder:map`.
- **Children:** open issues whose `parent` equals map id.
- **Claim:** set `assignee` before work. Open, unassigned tickets are unclaimed.
- **Block:** add blocker ids to `blocked_by`. Ticket is unblocked when every blocker is closed.
- **Frontier:** open, unassigned child issues with no open blocker.
- **Resolve:** append a dated resolution under `## Resolution`, set `state: closed`, then add one linked gist to map `Decisions so far`.
- **Links:** human-facing text uses issue title as link label; ids remain metadata only.
