import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { EMPTY_PROJECT_STATE, EMPTY_SESSION_STATE, type GenerationRecord } from "../src/core";
import { contextHintCard, generateHint, shouldRestoreLastSessionModel } from "../extensions/context-hint";

const theme = new Proxy(
	{
		bold: (text: string) => text,
		fg: (_color: string, text: string) => text,
	},
	{ get: (target, key) => Reflect.get(target, key) },
) as any;

test("restores last model only for fresh sessions", () => {
	expect(shouldRestoreLastSessionModel("new", 0)).toBe(true);
	expect(shouldRestoreLastSessionModel("startup", 0)).toBe(true);
	expect(shouldRestoreLastSessionModel("startup", 1)).toBe(false);
	expect(shouldRestoreLastSessionModel("resume", 0)).toBe(false);
});

test("repair retry keeps schema-constrained tool output", async () => {
	let attempts = 0;
	let repairRequest: any;
	const invalid = {
		turnDelta: { summary: "Implemented Context Hint", decisions: [] },
		sessionPatch: { status: "in_progress" },
		projectPatch: null,
		attentionCue: "none",
	};
	const valid = {
		turnDelta: {
			accomplished: ["Implemented Context Hint"],
			learned: [],
			ruledOut: [],
			codeCues: [],
			verification: [],
			failures: [],
			decisionsMade: [],
			questionsForHuman: [],
		},
		sessionPatch: { status: "implementing" as const },
		projectPatch: null,
		attentionCue: { level: "none" as const },
	};
	const ctx = {
		modelRegistry: {
			complete: async (_model: unknown, request: any, options: any) => {
				attempts++;
				if (attempts === 1) {
					return { content: [{ type: "toolCall", id: "bad", name: "context_hint_v1", arguments: invalid }] };
				}
				repairRequest = { request, options };
				const prompt = request.messages[0].content[0].text;
				const output = prompt.includes('"accomplished":[]') ? valid : invalid;
				return { content: [{ type: "text", text: JSON.stringify(output) }] };
			},
		},
	} as any;
	const evidence = {
		schemaVersion: 1 as const,
		capturedAt: "2026-09-15T00:00:00.000Z",
		userPrompt: "regenerate",
		assistantText: "",
		imageCount: 0,
		tools: [],
		knownPaths: [],
		projectFacts: [],
	};

	const hint = await generateHint(
		ctx,
		{ api: "openai-responses" } as any,
		evidence,
		EMPTY_SESSION_STATE,
		EMPTY_PROJECT_STATE,
		new AbortController().signal,
	);

	expect(attempts).toBe(2);
	expect(repairRequest.request.tools).toHaveLength(1);
	expect(repairRequest.request.tools[0].name).toBe("context_hint_v1");
	expect(repairRequest.options.toolChoice).toEqual({ type: "function", name: "context_hint_v1" });
	expect(hint).toEqual(valid);
});

test("accepts JSON split across multiple text blocks", async () => {
	const valid = JSON.stringify({
		turnDelta: {
			accomplished: ["Recovered"],
			learned: [],
			ruledOut: [],
			codeCues: [],
			verification: [],
			failures: [],
			decisionsMade: [],
			questionsForHuman: [],
		},
		sessionPatch: {},
		projectPatch: null,
		attentionCue: { level: "none" },
	});
	const ctx = {
		modelRegistry: {
			complete: async () => ({
				content: [
					{ type: "text", text: valid.slice(0, 40) },
					{ type: "text", text: valid.slice(40) },
				],
			}),
		},
	} as any;
	const evidence = {
		schemaVersion: 1 as const,
		capturedAt: "2026-09-15T00:00:00.000Z",
		userPrompt: "regenerate",
		assistantText: "",
		imageCount: 0,
		tools: [],
		knownPaths: [],
		projectFacts: [],
	};

	await expect(
		generateHint(ctx, { api: "openai-responses" } as any, evidence, EMPTY_SESSION_STATE, EMPTY_PROJECT_STATE, new AbortController().signal),
	).resolves.toMatchObject({ turnDelta: { accomplished: ["Recovered"] } });
});

test("falls back to a valid empty hint after two unusable responses", async () => {
	let attempts = 0;
	const ctx = {
		modelRegistry: {
			complete: async () => {
				attempts++;
				return { content: [] };
			},
		},
	} as any;
	const evidence = {
		schemaVersion: 1 as const,
		capturedAt: "2026-09-15T00:00:00.000Z",
		userPrompt: "regenerate",
		assistantText: "",
		imageCount: 0,
		tools: [],
		knownPaths: [],
		projectFacts: [],
	};

	await expect(
		generateHint(ctx, { api: "openai-responses" } as any, evidence, EMPTY_SESSION_STATE, EMPTY_PROJECT_STATE, new AbortController().signal),
	).resolves.toMatchObject({
		turnDelta: { accomplished: [], failures: [expect.stringContaining("no usable")], codeCues: [] },
		attentionCue: { level: "info" },
	});
	expect(attempts).toBe(2);
});

test("normalizes legacy scalar attention cues before validation", async () => {
	const args = {
		turnDelta: {
			accomplished: ["Recovered"],
			learned: [],
			ruledOut: [],
			codeCues: [],
			verification: [],
			failures: [],
			decisionsMade: [],
			questionsForHuman: [],
		},
		sessionPatch: {},
		projectPatch: null,
		attentionCue: "none",
	};
	const ctx = {
		modelRegistry: {
			complete: async () => ({
				content: [{ type: "toolCall", id: "hint", name: "context_hint_v1", arguments: args }],
			}),
		},
	} as any;
	const evidence = {
		schemaVersion: 1 as const,
		capturedAt: "2026-09-15T00:00:00.000Z",
		userPrompt: "regenerate",
		assistantText: "",
		imageCount: 0,
		tools: [],
		knownPaths: [],
		projectFacts: [],
	};

	await expect(
		generateHint(ctx, { api: "openai-responses" } as any, evidence, EMPTY_SESSION_STATE, EMPTY_PROJECT_STATE, new AbortController().signal),
	).resolves.toMatchObject({ attentionCue: { level: "none" } });
});

test("one card renders live loading, ready, and replacement error states within width", () => {
	let record = pendingRecord();
	let frame = 0;
	const card = contextHintCard(() => record, () => frame, false, theme);
	const loadingLines = card.render(48);
	expect(loadingLines[0].startsWith("╭┄┄ ⠋ GENERATING")).toBe(true);
	expect(loadingLines.join("\n")).toContain("┆  .");
	expect(loadingLines.join("\n")).not.toContain("Project · Session · Turn");
	expect(loadingLines.join("\n")).not.toContain("collapse");
	expect(loadingLines.join("\n")).not.toContain("expand");
	expect(loadingLines.at(-1)).toContain("┄");

	frame = 1;
	const loadingFrameOne = card.render(48).join("\n");
	expect(loadingFrameOne).toContain("╭┄┄ ⠙ GENERATING");
	expect(loadingFrameOne).toContain("┆  .");

	frame = 12;
	const loadingFrameTwo = card.render(48).join("\n");
	expect(loadingFrameTwo).toContain("╭┄┄ ⠹ GENERATING");
	expect(loadingFrameTwo).toContain("┆  ..");

	record.status = "ready";
	record.hint = {
		turnDelta: {
			accomplished: ["Implemented Context Hint"],
			learned: [],
			ruledOut: [],
			codeCues: [
				{
					path: "extensions/context-hint.ts",
					kind: "modified",
					reason: "Wraps long card text without truncation",
				},
				{
					path: "test/extension.test.ts",
					kind: "verified",
					reason: "Protects narrow-card rendering",
				},
			],
			verification: ["tests pass"],
			failures: [],
			decisionsMade: [],
			questionsForHuman: [],
			nextSuggestedAction: "Use it",
		},
		sessionPatch: {},
		projectPatch: null,
		attentionCue: { level: "none" },
	};
	record.sessionState = { ...EMPTY_SESSION_STATE, goal: "Ship v1", status: "done" };
	record.projectState = {
		...EMPTY_PROJECT_STATE,
		summary: "Context Hint keeps durable project context visible through narrow cards PROJECT_SUMMARY_END",
	};
	const expandedCard = contextHintCard(() => record, () => frame, true, theme);
	const readyLines = expandedCard.render(48);
	expect(readyLines.join("\n")).toContain("✓ CONTEXT HINT ◉");
	expect(readyLines[0].startsWith("┏━━ ✓ CONTEXT HINT")).toBe(true);
	expect(readyLines.at(-1)).toContain("━");
	expect(readyLines.some((line) => line.includes("┃"))).toBe(true);
	expect(readyLines.join("\n")).toContain("Implemented Context Hint");
	expect(readyLines.join("\n")).toContain("PROJECT_SUMMARY_END");
	expect(readyLines.join("\n")).toContain("CODE CUES");
	expect(readyLines.join("\n")).toContain("M extensions/context-hint.ts");
	expect(readyLines.join("\n")).toContain("Wraps long card text without truncation");
	expect(readyLines.join("\n")).toContain("T test/extension.test.ts");
	expect(readyLines.join("\n")).toContain("Protects narrow-card rendering");
	expect(readyLines.every((line) => visibleWidth(line) <= 48)).toBe(true);
	expect(readyLines.at(-1)).toContain(" ctrl+o · collapse ▲ ");
	expect(readyLines.join("\n")).toContain("DETAIL");

	const collapsedReadyLines = card.render(48);
	expect(collapsedReadyLines).toHaveLength(2);
	expect(collapsedReadyLines.at(-1)).toContain(" ctrl+o · expand ▼ ");
	expect(collapsedReadyLines[0]).toContain("✓ CONTEXT HINT ◡");
	expect(collapsedReadyLines.join("\n")).not.toContain("Implemented Context Hint");

	const narrowExpandedLines = expandedCard.render(12);
	expect(narrowExpandedLines.at(-1)).toContain(" ▲ ");
	expect(narrowExpandedLines.at(-1)).not.toContain("ctrl+o");
	expect(narrowExpandedLines.at(-1)).not.toContain("collapse");
	expect(narrowExpandedLines.every((line) => visibleWidth(line) <= 12)).toBe(true);

	record.hint.turnDelta.codeCues = undefined as any;
	record.hint.turnDelta.filesTouched = [
		{ path: "src/legacy.ts", lineStart: 42, lineEnd: 48, kind: "read", reason: "Legacy recovery point" },
	];
	expect(expandedCard.render(48).join("\n")).toContain("F src/legacy.ts:42-48");

	record.hint.turnDelta.filesTouched = [];
	expect(expandedCard.render(48).join("\n")).not.toContain("CODE CUES");

	record = { ...record, status: "error", error: "failed" };
	const errorLines = card.render(48);
	expect(errorLines.join("\n")).toContain("✕ ERROR");
	expect(errorLines.join("\n")).not.toContain("collapse");
	expect(errorLines.join("\n")).not.toContain("expand");
	expect(errorLines[0].startsWith("╭── ✕ ERROR")).toBe(true);
	expect(errorLines.at(-1)).toContain("─");
});

function pendingRecord(): GenerationRecord {
	return {
		schemaVersion: 1,
		generationId: "generation",
		sessionId: "session",
		status: "pending",
		createdAt: "2026-09-14T00:00:00.000Z",
		updatedAt: "2026-09-14T00:00:00.000Z",
		projectEpoch: 0,
		baseSessionState: EMPTY_SESSION_STATE,
	};
}
