# Context Hint

Context Hint turns settled Pi coding work into compact, human-facing memory cues so a developer can recover a project and work-line mental model later.

## Language

**Context Hint**:
A persistent TUI-only card that summarizes durable project context, current session context, and one settled user interaction for a human reader.
_Avoid_: Assistant summary, injected context, execution log

**Project Context**:
Slow-changing knowledge that defines the project world: purpose, architecture, constraints, conventions, durable decisions, and current phase.
_Avoid_: Project log, conversation summary

**Session Context**:
Rolling state for one active work line, including its goal, focus, hypotheses, status, open loops, blockers, and next steps.
_Avoid_: Chat history, project context

**Turn Evidence**:
Deterministic facts captured from one user interaction and its settled agent execution before semantic interpretation.
_Avoid_: Turn summary, model inference

**Turn Delta**:
Human-oriented account of what changed during one settled interaction, derived from Turn Evidence and prior context state.
_Avoid_: Tool log, session context

**Attention Cue**:
Short signal explaining why a future reader should inspect a Context Hint, especially for decisions, blockers, or risks.
_Avoid_: Notification, reminder

**Code Cue**:
A verified file or source-location anchor that helps a human retrieve relevant code without claiming unsupported line ranges.
_Avoid_: File log, guessed location
