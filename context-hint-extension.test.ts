import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { EMPTY_PROJECT_STATE, EMPTY_SESSION_STATE, type GenerationRecord } from "./.pi/context-hint/core";
import { contextHintCard } from "./.pi/extensions/context-hint-demo";

const theme = new Proxy(
	{
		bold: (text: string) => text,
		fg: (_color: string, text: string) => text,
	},
	{ get: (target, key) => Reflect.get(target, key) },
) as any;

test("one card renders loading, ready, and error states within width", () => {
	const record = pendingRecord();
	const card = contextHintCard(record, 0, false, theme);
	expect(card.render(48).join("\n")).toContain("GENERATING");

	record.status = "ready";
	record.hint = {
		turnDelta: {
			accomplished: ["Implemented Context Hint"],
			learned: [],
			ruledOut: [],
			filesTouched: [{ path: ".pi/extensions/context-hint-demo.ts" }],
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
	const readyLines = card.render(48);
	expect(readyLines.join("\n")).toContain("Implemented Context Hint");
	expect(readyLines.join("\n")).toContain("PROJECT_SUMMARY_END");
	expect(readyLines.every((line) => visibleWidth(line) <= 48)).toBe(true);

	record.status = "error";
	record.error = "failed";
	expect(card.render(48).join("\n")).toContain("ERROR");
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
