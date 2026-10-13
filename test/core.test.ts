import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_CONFIG,
	DEFAULT_CONTEXT_HINT_SETTINGS,
	EMPTY_SESSION_STATE,
	codeCuePaths,
	contextHintSettingsPath,
	mergeProjectState,
	mergeSessionState,
	latestGenerationRecord,
	normalizeCodeCueEvidence,
	projectPaths,
	readConfig,
	readContextHintSettings,
	readProjectDocument,
	redactAndTruncate,
	resetProjectDocument,
	restoreSessionState,
	updateProjectDocument,
	validateCodeCues,
	writeConfig,
	writeContextHintSettings,
	type GenerationRecord,
	type ProjectState,
} from "../src/core";

const temporaryDirectories: string[] = [];
afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("redactAndTruncate", () => {
	test("removes common credentials before bounding text", () => {
		const text = "Authorization: Bearer secret-token\napiKey=sk-live-secret\nkeep me";
		expect(redactAndTruncate(text, 200)).toBe(
			"Authorization: Bearer [REDACTED]\napiKey=[REDACTED]\nkeep me",
		);
	});
});

describe("state reducers", () => {
	test("session patches preserve omitted fields and clear explicit arrays", () => {
		const state = mergeSessionState(
			{ ...EMPTY_SESSION_STATE, goal: "Ship v1", blockers: ["API gap"], nextSteps: ["test"] },
			{ status: "verifying", blockers: [] },
		);

		expect(state).toEqual({
			...EMPTY_SESSION_STATE,
			goal: "Ship v1",
			status: "verifying",
			blockers: [],
			nextSteps: ["test"],
		});
	});

	test("concurrent project patches preserve distinct durable array facts", () => {
		const initial: ProjectState = {
			summary: "Context cards",
			purpose: "Restore mental model",
			architecture: ["Pi extension"],
			constraints: ["TUI only"],
			conventions: [],
			importantDecisions: [{ decision: "Disabled by default" }],
			currentPhase: "v1",
		};
		const state = mergeProjectState(initial, {
			architecture: ["Sidecar state"],
			importantDecisions: [{ decision: "Disabled by default", rationale: "Avoid surprise cost" }],
		});

		expect(state.architecture).toEqual(["Pi extension", "Sidecar state"]);
		expect(state.importantDecisions).toEqual([
			{ decision: "Disabled by default", rationale: "Avoid surprise cost" },
		]);
	});
});

describe("project persistence", () => {
	test("serializes concurrent patches and rejects stale work after reset", async () => {
		const agentDir = await mkdtemp(join(tmpdir(), "context-hint-test-"));
		temporaryDirectories.push(agentDir);
		const paths = projectPaths(agentDir, "git:/project/.git");

		await Promise.all([
			updateProjectDocument(paths, "git:/project/.git", "/project/a", 0, { architecture: ["Pi extension"] }),
			updateProjectDocument(paths, "git:/project/.git", "/project/b", 0, { constraints: ["TUI only"] }),
		]);
		const merged = await readProjectDocument(paths, "git:/project/.git", "/project/a");
		expect(merged.state.architecture).toEqual(["Pi extension"]);
		expect(merged.state.constraints).toEqual(["TUI only"]);

		const reset = await resetProjectDocument(paths, "git:/project/.git", "/project/a");
		const stale = await updateProjectDocument(paths, "git:/project/.git", "/project/a", 0, { summary: "stale" });
		expect(stale.epoch).toBe(reset.epoch);
		expect(stale.state.summary).toBe("");
	});
});

describe("summary model configuration", () => {
	test("reads legacy configuration and persists thinking memory per project", async () => {
		const agentDir = await mkdtemp(join(tmpdir(), "context-hint-model-config-"));
		temporaryDirectories.push(agentDir);
		const first = projectPaths(agentDir, "git:/project/first");
		const second = projectPaths(agentDir, "git:/project/second");
		await mkdir(first.dir, { recursive: true });
		await writeFile(first.config, JSON.stringify({ schemaVersion: 1, enabled: true, model: { mode: "inherit" } }));

		expect(await readConfig(first)).toEqual({ schemaVersion: 1, enabled: true, model: { mode: "inherit" } });
		expect(await readConfig(second)).toEqual({ schemaVersion: 1, enabled: false, model: { mode: "inherit" } });

		const config = {
			...DEFAULT_CONFIG,
			model: { mode: "explicit" as const, provider: "openai", id: "reasoning/model" },
			thinkingLevels: { "openai/reasoning/model": "xhigh" as const },
		};
		await writeConfig(first, config);
		expect(await readConfig(first)).toEqual(config);
		expect(await readConfig(second)).toEqual({ schemaVersion: 1, enabled: false, model: { mode: "inherit" } });
	});
});

describe("global display settings", () => {
	test("uses defaults, persists updates, and repairs invalid files", async () => {
		const agentDir = await mkdtemp(join(tmpdir(), "context-hint-settings-"));
		temporaryDirectories.push(agentDir);
		expect(await readContextHintSettings(agentDir)).toEqual(DEFAULT_CONTEXT_HINT_SETTINGS);

		const settings = { schemaVersion: 1 as const, expanded: false, motion: "reduce" as const };
		await writeContextHintSettings(agentDir, settings);
		expect(await readContextHintSettings(agentDir)).toEqual(settings);

		await writeFile(contextHintSettingsPath(agentDir), JSON.stringify({ schemaVersion: 1, expanded: "no", motion: "animate" }));
		expect(await readContextHintSettings(agentDir)).toEqual(DEFAULT_CONTEXT_HINT_SETTINGS);
	});
});

describe("branch restoration", () => {
	test("uses latest ready hint after latest session reset", () => {
		const beforeReset = record("old", "Old goal");
		const afterReset = record("new", "New goal");
		const records = new Map([
			[beforeReset.generationId, beforeReset],
			[afterReset.generationId, afterReset],
		]);
		const entries = [
			card("old"),
			{ type: "custom", customType: "context-hint-v1", data: { kind: "session-reset" } },
			card("new"),
		];

		expect(restoreSessionState(entries, records).goal).toBe("New goal");
	});

	test("a new regenerate entry leaves inherited card records immutable", () => {
		const inherited = record("old", "Inherited goal");
		const regenerated = record("new", "Regenerated goal");
		const records = new Map([
			[inherited.generationId, inherited],
			[regenerated.generationId, regenerated],
		]);
		const parentEntries = [card("old")];
		const childEntries = [card("old"), card("new")];

		expect(latestGenerationRecord(parentEntries, records)?.generationId).toBe("old");
		expect(latestGenerationRecord(childEntries, records)?.generationId).toBe("new");
	});
});

describe("code cues", () => {
	test("uses only paths from successful tool calls", () => {
		expect(
			codeCuePaths([
				{ name: "edit", ok: true, input: "", result: "", paths: ["src/card.ts"] },
				{ name: "read", ok: true, input: "", result: "", paths: ["src/card.ts", "src/state.ts"] },
				{ name: "edit", ok: false, input: "", result: "failed", paths: ["src/failed.ts"] },
			]),
		).toEqual(["src/card.ts", "src/state.ts"]);
	});

	test("normalizes legacy evidence to successful tool paths", () => {
		const evidence = {
			schemaVersion: 1 as const,
			capturedAt: "2026-09-14T00:00:00.000Z",
			userPrompt: "regenerate",
			assistantText: "",
			imageCount: 0,
			tools: [
				{ name: "edit", ok: true, input: "", result: "", paths: ["src/card.ts"] },
				{ name: "edit", ok: false, input: "", result: "failed", paths: ["src/failed.ts"] },
			],
			knownPaths: ["CONTEXT.md", "src/card.ts", "src/failed.ts"],
			projectFacts: [],
		};

		expect(normalizeCodeCueEvidence(evidence).knownPaths).toEqual(["src/card.ts"]);
	});

	test("rejects invented paths and blank reasons", () => {
		expect(() =>
			validateCodeCues(
				[{ path: "src/invented.ts", kind: "focal", reason: "Relevant implementation" }],
				new Set(["src/known.ts"]),
			),
		).toThrow("unsupported code cue");
		expect(() =>
			validateCodeCues(
				[{ path: "src/known.ts", kind: "focal", reason: "   " }],
				new Set(["src/known.ts"]),
			),
		).toThrow("unsupported code cue reason");
	});
});

function card(generationId: string) {
	return { type: "custom", customType: "context-hint-v1", data: { kind: "hint", generationId } };
}

function record(generationId: string, goal: string): GenerationRecord {
	return {
		schemaVersion: 1,
		generationId,
		sessionId: "session",
		status: "ready",
		createdAt: "2026-09-14T00:00:00.000Z",
		updatedAt: "2026-09-14T00:00:01.000Z",
		projectEpoch: 0,
		baseSessionState: EMPTY_SESSION_STATE,
		sessionState: { ...EMPTY_SESSION_STATE, goal },
		projectState: {
			summary: "",
			purpose: "",
			architecture: [],
			constraints: [],
			conventions: [],
			importantDecisions: [],
			currentPhase: "",
		},
		hint: {
			turnDelta: {
				accomplished: [],
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
		},
	};
}
