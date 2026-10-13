import { expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TuiMainScreen, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
	DEFAULT_CONFIG,
	DEFAULT_CONTEXT_HINT_SETTINGS,
	EMPTY_PROJECT_STATE,
	EMPTY_SESSION_STATE,
	ENTRY_TYPE,
	latestGenerationRecord,
	projectPaths,
	readConfig,
	writeConfig,
	writeContextHintSettings,
	writeGeneration,
	type GenerationRecord,
} from "../src/core";
import registerContextHint, {
	contextHintArgumentCompletions,
	contextHintCard,
	contextHintStatus,
	eyeBlinkFrames,
	eyeGlyph,
	eyeTransitionFrames,
	generateHint,
	randomBlinkDelay,
	randomCollapsedPeekDelay,
	shouldRestoreLastSessionModel,
} from "../extensions/context-hint";

const theme = new Proxy(
	{
		bold: (text: string) => text,
		fg: (_color: string, text: string) => text,
	},
	{ get: (target, key) => Reflect.get(target, key) },
) as any;

test("lists Context Hint actions with descriptions", () => {
	expect(contextHintArgumentCompletions("")).toContainEqual({
		value: "reset-project",
		label: "reset-project",
		description: "Reset durable Project Context",
	});
	expect(contextHintArgumentCompletions("motion ")?.map(({ value }) => value)).toEqual([
		"motion reduce",
		"motion animate",
	]);
	expect(contextHintArgumentCompletions("toggle")).toContainEqual({
		value: "toggle",
		label: "toggle",
		description: "Expand or collapse cards (Alt+O)",
	});
	expect(contextHintArgumentCompletions("unknown")).toBeNull();
});

test("restores last model only for fresh sessions", () => {
	expect(shouldRestoreLastSessionModel("new", 0)).toBe(true);
	expect(shouldRestoreLastSessionModel("startup", 0)).toBe(true);
	expect(shouldRestoreLastSessionModel("startup", 1)).toBe(false);
	expect(shouldRestoreLastSessionModel("resume", 0)).toBe(false);
});

test("model, enable, and status notices show effective summary model and thinking", async () => {
	const temp = await mkdtemp(join(tmpdir(), "context-hint-model-notice-"));
	const agentDir = join(temp, "agent");
	const cwd = join(temp, "project");
	await mkdir(cwd);
	await writeFile(join(cwd, "README.md"), "notice test");
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;

	try {
		const mainModel = { provider: "openai", id: "main", api: "openai-responses", reasoning: true };
		const summaryModel = { provider: "anthropic", id: "summary", api: "anthropic-messages", reasoning: true };
		const paths = projectPaths(agentDir, `dir:${await realpath(cwd)}`);
		await writeConfig(paths, { ...DEFAULT_CONFIG, thinkingLevels: { "openai/main": "medium" } });
		await writeContextHintSettings(agentDir, { ...DEFAULT_CONTEXT_HINT_SETTINGS, motion: "reduce" });

		const listeners = new Map<string, (event: any, ctx: any) => any>();
		const commands = new Map<string, (args: string, ctx: any) => any>();
		const notices: Array<{ message: string; level: string }> = [];
		const availableModels = [summaryModel];
		let picker: any;
		const ctx = {
			hasUI: true,
			mode: "tui",
			cwd,
			model: mainModel,
			thinkingLevel: "high",
			scopedModels: [{ model: summaryModel }],
			modelRegistry: { getAvailable: () => availableModels },
			sessionManager: { getSessionId: () => "session", getEntries: () => [], getBranch: () => [] },
			ui: {
				theme,
				notify: (message: string, level: string) => notices.push({ message, level }),
				setWidget() {},
				setStatus() {},
				custom(factory: (tui: any, theme: any, keybindings: any, done: (value: any) => void) => any) {
					return new Promise((resolve) => {
						picker = factory({ requestRender() {} }, theme, {}, resolve);
					});
				},
			},
		} as any;
		const pi = {
			on: (name: string, listener: (event: any, ctx: any) => any) => listeners.set(name, listener),
			registerCommand: (name: string, command: { handler: (args: string, ctx: any) => any }) => commands.set(name, command.handler),
			registerEntryRenderer() {},
			registerShortcut() {},
			exec: async () => ({ code: 1, stdout: "", stderr: "" }),
		};
		registerContextHint(pi as any);
		await listeners.get("session_start")!({ reason: "resume" }, ctx);

		const saving = commands.get("context-hint")!("model", ctx);
		picker.handleInput("\x1b[B");
		picker.handleInput("\x1b[C");
		picker.handleInput("\r");
		await saving;
		const saveMessage = notices.at(-1)?.message;
		await commands.get("context-hint")!("status", ctx);
		const explicitStatus = notices.at(-1)?.message;
		const configBeforeCancel = await readConfig(paths);
		const noticesBeforeCancel = notices.length;
		const cancel = commands.get("context-hint")!("model", ctx);
		picker.handleInput("\x1b");
		await cancel;
		expect(await readConfig(paths)).toEqual(configBeforeCancel);
		expect(notices).toHaveLength(noticesBeforeCancel);
		await commands.get("context-hint")!("enable", ctx);
		const explicitEnable = notices.at(-1)?.message;

		ctx.scopedModels = [];
		availableModels.length = 0;
		await commands.get("context-hint")!("status", ctx);
		const unavailableStatus = notices.at(-1)?.message;
		await commands.get("context-hint")!("enable", ctx);
		const unavailableEnable = notices.at(-1)?.message;

		const inheritSave = commands.get("context-hint")!("model", ctx);
		picker.handleInput("\r");
		await inheritSave;
		const inheritMessage = notices.at(-1)?.message;
		await commands.get("context-hint")!("status", ctx);
		const inheritStatus = notices.at(-1)?.message;
		await commands.get("context-hint")!("enable", ctx);
		const inheritEnable = notices.at(-1)?.message;
		expect(ctx.model).toBe(mainModel);
		expect(ctx.thinkingLevel).toBe("high");

		ctx.model = undefined;
		await commands.get("context-hint")!("status", ctx);
		const noModelStatus = notices.at(-1)?.message;
		await commands.get("context-hint")!("enable", ctx);
		const noModelEnable = notices.at(-1)?.message;

		expect(saveMessage).toBe("Context Hint summary model anthropic/summary; thinking minimal saved.");
		expect(explicitStatus).toContain("summary model anthropic/summary; thinking minimal");
		expect(explicitEnable).toContain("summary model anthropic/summary; thinking minimal");
		expect(explicitEnable).toContain("Alt+O toggles cards");
		expect(explicitEnable).toContain("Next settled interaction generates a card.");
		expect(unavailableStatus).toContain("summary model anthropic/summary (unavailable); thinking unavailable");
		expect(unavailableEnable).toContain("summary model anthropic/summary (unavailable); thinking unavailable");
		expect(inheritMessage).toBe("Context Hint summary model openai/main (inherit); thinking medium saved.");
		expect(inheritStatus).toContain("summary model openai/main (inherit); thinking medium");
		expect(inheritEnable).toContain("summary model openai/main (inherit); thinking medium");
		expect(noModelStatus).toContain("summary model inherit current (no active model); thinking unavailable");
		expect(noModelEnable).toContain("summary model inherit current (no active model); thinking unavailable");
		expect(ctx.model).toBeUndefined();
		expect(ctx.thinkingLevel).toBe("high");
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		await rm(temp, { recursive: true, force: true });
	}
});

test("summary and repair requests keep schema tools and selected thinking level", async () => {
	let attempts = 0;
	let repairRequest: any;
	const requestOptions: any[] = [];
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
		thinkingLevel: "high",
		modelRegistry: {
			streamSimple: (_model: unknown, request: any, options: any) => {
				attempts++;
				requestOptions.push(options);
				if (attempts === 1) {
					return { result: async () => ({ content: [{ type: "toolCall", id: "bad", name: "context_hint_v1", arguments: invalid }] }) };
				}
				repairRequest = { request, options };
				const prompt = request.messages[0].content[0].text;
				const output = prompt.includes('"accomplished":[]') ? valid : invalid;
				return { result: async () => ({ content: [{ type: "text", text: JSON.stringify(output) }] }) };
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
		"xhigh",
	);

	expect(attempts).toBe(2);
	expect(repairRequest.request.tools).toHaveLength(1);
	expect(repairRequest.request.tools[0].name).toBe("context_hint_v1");
	expect(repairRequest.options.toolChoice).toBe("auto");
	expect(requestOptions.map((options) => options.reasoning)).toEqual(["xhigh", "xhigh"]);
	expect(ctx.thinkingLevel).toBe("high");
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
			streamSimple: () => ({
				result: async () => ({
					content: [
						{ type: "text", text: valid.slice(0, 40) },
						{ type: "text", text: valid.slice(40) },
					],
				}),
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
		generateHint(ctx, { api: "openai-responses" } as any, evidence, EMPTY_SESSION_STATE, EMPTY_PROJECT_STATE, new AbortController().signal, "off"),
	).resolves.toMatchObject({ turnDelta: { accomplished: ["Recovered"] } });
});

test("falls back to a valid empty hint after two unusable responses", async () => {
	let attempts = 0;
	const ctx = {
		modelRegistry: {
			streamSimple: () => ({
				result: async () => {
					attempts++;
					return { content: [] };
				},
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
		generateHint(ctx, { api: "openai-responses" } as any, evidence, EMPTY_SESSION_STATE, EMPTY_PROJECT_STATE, new AbortController().signal, "off"),
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
			streamSimple: () => ({
				result: async () => ({
					content: [{ type: "toolCall", id: "hint", name: "context_hint_v1", arguments: args }],
				}),
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
		generateHint(ctx, { api: "openai-responses" } as any, evidence, EMPTY_SESSION_STATE, EMPTY_PROJECT_STATE, new AbortController().signal, "off"),
	).resolves.toMatchObject({ attentionCue: { level: "none" } });
});

test("eye animation uses approved three-cell frames and reduced motion stays static", () => {
	expect(eyeGlyph("open")).toBe("⠢⣋⠔");
	expect(eyeGlyph("half")).toBe("⠔⣖⠢");
	expect(eyeGlyph("slit")).toBe("⠠⡤⠄");
	expect(eyeGlyph("closed")).toBe("⢄⣀⡠");
	for (const phase of ["open", "half", "slit", "closed"] as const) {
		const frame = eyeGlyph(phase);
		expect([...frame]).toHaveLength(3);
		expect(visibleWidth(frame)).toBe(3);
	}
	expect(eyeTransitionFrames(true)).toEqual(["closed", "slit", "half", "open"]);
	expect(eyeTransitionFrames(false)).toEqual(["open", "half", "slit", "closed"]);
	expect(eyeBlinkFrames()).toEqual(["open", "half", "slit", "closed", "slit", "half", "open"]);
	expect(randomBlinkDelay(() => 0)).toBe(5_000);
	expect(randomBlinkDelay(() => 1 - Number.EPSILON)).toBe(10_000);
	expect(randomCollapsedPeekDelay(() => 0)).toBe(8_000);
	expect(randomCollapsedPeekDelay(() => 1 - Number.EPSILON)).toBe(12_000);

	const record = pendingRecord();
	const pending = contextHintCard(() => record, () => 9, true, theme, {
		phase: "open",
		motion: "reduce",
	});
	expect(pending.render(48)).toEqual(["⠋ GENERATING CONTEXT HINT"]);

	record.status = "ready";
	record.hint = emptyHint();
	record.sessionState = EMPTY_SESSION_STATE;
	record.projectState = EMPTY_PROJECT_STATE;
	const ready = contextHintCard(() => record, () => 0, true, theme, {
		phase: "half",
		motion: "animate",
	});
	expect(ready.render(48)[0]).toContain("⠔⣖⠢ CONTEXT HINT");
	const reduced = contextHintCard(() => record, () => 0, true, theme, {
		phase: "closed",
		motion: "reduce",
	});
	expect(reduced.render(48)[0]).toContain("⠢⣋⠔ CONTEXT HINT");
	const disabled = contextHintCard(() => record, () => 0, true, theme, {
		phase: "open",
		motion: "reduce",
		enabled: false,
	});
	expect(disabled.render(48)[0]).toContain("⢄⣀⡠ CONTEXT HINT");
});

test("card reads live expansion and eye state on every render", () => {
	const record = pendingRecord();
	record.status = "ready";
	record.hint = emptyHint();
	record.sessionState = EMPTY_SESSION_STATE;
	record.projectState = EMPTY_PROJECT_STATE;
	let expanded = true;
	let phase: "open" | "half" | "slit" | "closed" = "open";
	let motion: "animate" | "reduce" = "animate";
	const card = contextHintCard(() => record, () => 0, () => expanded, theme, {
		phase: () => phase,
		motion: () => motion,
	});

	const openLines = card.render(48).join("\n");
	expect(openLines).toContain("⠢⣋⠔ CONTEXT HINT");
	expect(openLines).toContain("PROJECT");
	expect(openLines).not.toContain("alt+o");

	expanded = false;
	phase = "half";
	const transitioningLines = card.render(48).join("\n");
	expect(transitioningLines).toContain("≡ CONTEXT HINT · Card collapsed");
	expect(transitioningLines).not.toContain("PROJECT");
	expect(transitioningLines).not.toContain("◍");
	expect(transitioningLines).not.toContain("alt+o");

	phase = "closed";
	const closedLines = card.render(48).join("\n");
	expect(closedLines).toContain("≡ CONTEXT HINT · Card collapsed");

	expanded = true;
	motion = "reduce";
	phase = "closed";
	expect(card.render(48).join("\n")).toContain("⠢⣋⠔ CONTEXT HINT");
});

test("collapsed pending, ready, error, and missing cards render one safe line", () => {
	const pending = pendingRecord();
	const ready = { ...pending, status: "ready" as const };
	const error = { ...pending, status: "error" as const, error: "secret failure detail" };
	for (const record of [pending, ready, error, undefined]) {
		const card = contextHintCard(() => record, () => 5, false, theme);
		for (let width = 1; width <= 48; width++) {
			const lines = card.render(width);
			expect(lines).toHaveLength(1);
			expect(visibleWidth(lines[0])).toBeLessThanOrEqual(width);
			expect(lines.join("\n")).not.toContain("┏");
			expect(lines.join("\n")).not.toContain("⠋");
			expect(lines.join("\n")).not.toContain("ERROR");
			expect(lines.join("\n")).not.toContain("secret failure detail");
			expect(lines.join("\n")).not.toContain("alt+o");
		}
		expect(card.render(48)[0]).toContain("≡ CONTEXT HINT · Card collapsed");
	}
});

test("one card renders live loading, ready, and replacement error states within width", () => {
	let record = pendingRecord();
	let frame = 0;
	const card = contextHintCard(() => record, () => frame, true, theme);
	const loadingLines = card.render(48);
	expect(loadingLines).toEqual(["⠋ GENERATING CONTEXT HINT"]);
	expect(loadingLines.join("\n")).not.toContain(".");
	expect(loadingLines.join("\n")).not.toContain("Project · Session · Turn");
	expect(loadingLines.join("\n")).not.toContain("collapse");
	expect(loadingLines.join("\n")).not.toContain("expand");

	frame = 1;
	const loadingFrameOne = card.render(48).join("\n");
	expect(loadingFrameOne).toBe("⠙ GENERATING CONTEXT HINT");

	frame = 12;
	const loadingFrameTwo = card.render(48).join("\n");
	expect(loadingFrameTwo).toBe("⠹ GENERATING CONTEXT HINT");

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
	expect(readyLines.join("\n")).toContain("⠢⣋⠔ CONTEXT HINT");
	expect(readyLines[0].startsWith("┏━━ ⠢⣋⠔ CONTEXT HINT")).toBe(true);
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
	expect(readyLines.join("\n")).not.toContain("alt+o");
	expect(readyLines.join("\n")).toContain("DETAIL");

	const collapsedCard = contextHintCard(() => record, () => frame, false, theme);
	const collapsedReadyLines = collapsedCard.render(48);
	expect(collapsedReadyLines).toHaveLength(1);
	expect(collapsedReadyLines[0]).toContain("≡ CONTEXT HINT · Card collapsed");
	expect(collapsedReadyLines.join("\n")).not.toContain("◡");
	expect(collapsedReadyLines.join("\n")).not.toContain("Implemented Context Hint");
	expect(collapsedReadyLines.every((line) => visibleWidth(line) <= 48)).toBe(true);

	const narrowExpandedLines = expandedCard.render(12);
	expect(narrowExpandedLines.at(-1)).not.toContain("alt+o");
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
	const errorLines = expandedCard.render(48);
	expect(errorLines.join("\n")).toContain("✕ ERROR");
	expect(errorLines.join("\n")).not.toContain("collapse");
	expect(errorLines.join("\n")).not.toContain("expand");
	expect(errorLines[0].startsWith("╭── ✕ ERROR")).toBe(true);
	expect(errorLines.at(-1)).toContain("─");
});

test("footer status stays compact and prioritizes current work and actual expansion", () => {
	const pending = { ...pendingRecord(), status: "pending" as const };
	const failed = { ...pendingRecord(), status: "error" as const, error: "failed" };
	const ready = { ...pendingRecord(), status: "ready" as const };
	const status = (expanded: boolean, enabled: boolean, record: GenerationRecord | undefined, phase: "open" | "half" | "slit" | "closed" = "closed", motion: "animate" | "reduce" = "animate") =>
		contextHintStatus({ expanded, motion }, enabled, record, "session", phase, theme);

	expect(status(false, true, pending)).toBe("⢄⣀⡠ context-hint: generating");
	expect(status(true, true, failed, "half")).toBe("⠔⣖⠢ context-hint: error");
	expect(status(false, true, { ...pending, sessionId: "parent" })).toBe("⢄⣀⡠ context-hint: collapsed");
	expect(status(true, true, { ...failed, sessionId: "parent" }, "half")).toBe("⠔⣖⠢ context-hint: error");
	expect(status(false, false, pending)).toBe("⢄⣀⡠ context-hint: disabled");
	expect(status(true, false, failed, "half")).toBe("⢄⣀⡠ context-hint: disabled");
	expect(status(true, true, ready, "half")).toBe("⠔⣖⠢ context-hint: expanded");
	expect(status(false, true, ready, "half", "reduce")).toBe("⢄⣀⡠ context-hint: collapsed");
	expect(status(true, true, ready, "half", "reduce")).toBe("⠢⣋⠔ context-hint: expanded");
	expect(status(true, true, undefined)).toBe("⢄⣀⡠ context-hint: expanded");
	expect(status(true, true, ready, "open")).toBe("⠢⣋⠔ context-hint: expanded");
	expect(visibleWidth(status(true, true, ready, "open"))).toBe(26);

	const oldError = { ...failed, generationId: "old" };
	const newestReady = { ...ready, generationId: "new" };
	const latest = latestGenerationRecord(
		[
			{ type: "custom", customType: ENTRY_TYPE, data: { kind: "hint", generationId: "old" } },
			{ type: "custom", customType: ENTRY_TYPE, data: { kind: "hint", generationId: "new" } },
		],
		new Map<string, GenerationRecord>([["old", oldError], ["new", newestReady]]),
	);
	expect(status(true, true, latest)).toBe("⢄⣀⡠ context-hint: expanded");
	expect(status(true, true, latest)).not.toContain("error");

	const colorCalls: string[] = [];
	const footerTheme = {
		bold: (_text: string) => { throw new Error("footer name and state must not be bold"); },
		fg: (color: string, text: string) => { colorCalls.push(`${color}:${text}`); return text; },
	} as any;
	contextHintStatus({ expanded: true, motion: "animate" }, true, ready, "session", "open", footerTheme);
	expect(colorCalls).toContain("muted:context-hint");
	expect(colorCalls).toContain("dim::");
	expect(colorCalls).toContain("muted:expanded");
	colorCalls.length = 0;
	contextHintStatus({ expanded: false, motion: "animate" }, true, ready, "session", "closed", footerTheme);
	expect(colorCalls).toContain("muted:collapsed");
	colorCalls.length = 0;
	contextHintStatus({ expanded: false, motion: "animate" }, true, pending, "session", "closed", footerTheme);
	expect(colorCalls).toContain("accent:generating");
	colorCalls.length = 0;
	contextHintStatus({ expanded: false, motion: "animate" }, true, failed, "session", "closed", footerTheme);
	expect(colorCalls).toContain("error:error");
	colorCalls.length = 0;
	contextHintStatus({ expanded: false, motion: "animate" }, false, ready, "session", "closed", footerTheme);
	expect(colorCalls).toContain("muted:disabled");
});

test("eye and title contrast keep shortcuts subdued", () => {
	const colors: string[] = [];
	const themed = {
		bold: (text: string) => text,
		fg: (color: string, text: string) => {
			colors.push(`${color}:${text}`);
			return text;
		},
	} as any;
	contextHintStatus({ expanded: true, motion: "animate" }, true, undefined, "session", "open", themed);
	const record = { ...pendingRecord(), status: "ready" as const, hint: emptyHint(), sessionState: EMPTY_SESSION_STATE, projectState: EMPTY_PROJECT_STATE };
	contextHintCard(() => record, () => 0, true, themed, { phase: "open", motion: "animate" }).render(48);
	contextHintCard(() => undefined, () => 0, false, themed).render(48);
	expect(colors).toContain("muted:context-hint");
	expect(colors).toContain("dim::");
	expect(colors).toContain("muted:expanded");
	expect(colors).toContain("muted:⠢");
	expect(colors).toContain("accent:⣋");
	expect(colors).toContain("muted:⠔");
	expect(colors).toContain("success:CONTEXT HINT");
	expect(colors).toContain("muted:≡ ");
	expect(colors).toContain("accent:CONTEXT HINT");
	expect(colors).toContain("muted: · Card collapsed");

	const ansiColors: Record<string, string> = { muted: "38;5;244", accent: "38;5;208", success: "38;5;34", dim: "38;5;242", error: "38;5;196", borderMuted: "38;5;240" };
	const ansiTheme = {
		bold: (text: string) => `\u001b[1m${text}\u001b[0m`,
		fg: (color: string, text: string) => `\u001b[${ansiColors[color]}m${text}\u001b[0m`,
	} as any;
	const ansiStatus = contextHintStatus({ expanded: true, motion: "animate" }, true, undefined, "session", "open", ansiTheme);
	const ansiCard = contextHintCard(() => record, () => 0, true, ansiTheme, { phase: "open", motion: "animate" }).render(48)[0];
	const sprite = "\u001b[38;5;244m⠢\u001b[0m\u001b[38;5;208m⣋\u001b[0m\u001b[38;5;244m⠔\u001b[0m";
	expect(ansiStatus).toContain(sprite);
	expect(visibleWidth(ansiStatus)).toBe(26);
	expect(ansiCard).toContain(sprite);
	expect(ansiStatus.indexOf("\u001b[38;5;244mcontext-hint")).toBeGreaterThan(ansiStatus.indexOf(sprite));
	expect(ansiCard.indexOf("\u001b[38;5;34m\u001b[1mCONTEXT HINT")).toBeGreaterThan(ansiCard.indexOf(sprite));
});

test("one shared eye phase drives expanded card title and footer status", () => {
	const record = pendingRecord();
	record.status = "ready";
	record.hint = emptyHint();
	record.sessionState = EMPTY_SESSION_STATE;
	record.projectState = EMPTY_PROJECT_STATE;
	const card = contextHintCard(() => record, () => 0, true, theme, { phase: "half", motion: "animate" });
	const status = contextHintStatus({ expanded: true, motion: "animate" }, true, record, "session", "half", theme);
	expect(card.render(48)[0]).toContain("⠔⣖⠢ CONTEXT HINT");
	expect(status).toContain("⠔⣖⠢ context-hint: expanded");
});

test("footer eye stays synced without repainting scrollback across peeks, blinks, and session cleanup", async () => {
	const temp = await mkdtemp(join(tmpdir(), "context-hint-timers-"));
	const agentDir = join(temp, "agent");
	const cwd = join(temp, "project");
	await mkdir(cwd);
	await writeFile(join(cwd, "README.md"), "test project");
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;

	const originalRandom = Math.random;
	const originalSetTimeout = globalThis.setTimeout;
	const originalClearTimeout = globalThis.clearTimeout;
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	let nextId = 0;
	const timers = new Map<number, { callback: () => void; delay: number; interval: boolean }>();
	const addTimer = (callback: () => void, delay: number, interval: boolean) => {
		const id = ++nextId;
		timers.set(id, { callback, delay, interval });
		return { id } as any;
	};
	const clearTimer = (timer: unknown) => timers.delete((timer as { id: number }).id);
	const fireTimer = (delay: number) => {
		const [id, timer] = [...timers].find(([, item]) => item.delay === delay)!;
		if (!timer.interval) timers.delete(id);
		timer.callback();
	};
	let sessionId = "first";
	const entries: any[] = [];
	const statuses = new Map<string, string>();
	const notifications: Array<{ message: string; level: string }> = [];
	const menuChoices: string[][] = [];
	const terminalWrites: string[] = [];
	const tui = new TuiMainScreen({
		columns: 80,
		rows: 24,
		write: (data: string) => terminalWrites.push(data),
		hideCursor() {},
		showCursor() {},
	} as any);
	const originalRender = tui.render;
	// Pi and extensions can load separate copies of pi-tui; avoid relying on instanceof.
	const widgetTui = new Proxy(tui, { getPrototypeOf: () => Object.prototype });
	expect(widgetTui instanceof TuiMainScreen).toBe(false);
	let animationWidget: { dispose?(): void } | undefined;
	const listeners = new Map<string, (event: any, ctx: any) => any>();
	const commands = new Map<string, (args: string, ctx: any) => any>();
	const shortcuts = new Map<string, (ctx: any) => any>();
	const renderers = new Map<string, (entry: any, options: any, theme: any) => any>();
	const ctx = {
		hasUI: true,
		mode: "tui",
		cwd,
		model: undefined,
		modelRegistry: {},
		scopedModels: [],
		isIdle: () => true,
		isProjectTrusted: () => true,
		sessionManager: {
			getSessionId: () => sessionId,
			getEntries: () => entries,
			getBranch: () => entries,
		},
		ui: {
			theme,
			setWidget: (_key: string, factory: ((tui: TuiMainScreen) => typeof animationWidget) | undefined) => {
				animationWidget?.dispose?.();
				animationWidget = factory?.(widgetTui);
			},
			notify: (message: string, level: string) => notifications.push({ message, level }),
			select: async (_title: string, choices: string[]) => {
				menuChoices.push(choices);
				return undefined;
			},
			setStatus: (key: string, value: string | undefined) => {
				if (value === undefined) statuses.delete(key);
				else statuses.set(key, value);
			},
		},
	} as any;
	const pi = {
		on: (name: string, listener: (event: any, ctx: any) => any) => listeners.set(name, listener),
		registerCommand: (name: string, command: { handler: (args: string, ctx: any) => any }) => commands.set(name, command.handler),
		registerEntryRenderer: (type: string, renderer: (entry: any, options: any, theme: any) => any) => renderers.set(type, renderer),
		registerShortcut: (key: string, shortcut: { handler: (ctx: any) => any }) => shortcuts.set(key, shortcut.handler),
		appendEntry: () => {},
		exec: async () => ({ code: 1, stdout: "", stderr: "" }),
	};

	try {
		Math.random = () => 0;
		globalThis.setTimeout = ((callback: () => void, delay = 0) => addTimer(callback, delay, false)) as any;
		globalThis.clearTimeout = clearTimer as any;
		globalThis.setInterval = ((callback: () => void, delay = 0) => addTimer(callback, delay, true)) as any;
		globalThis.clearInterval = clearTimer as any;
		const paths = projectPaths(agentDir, `dir:${await realpath(cwd)}`);
		await writeConfig(paths, { ...DEFAULT_CONFIG, enabled: true });
		await writeContextHintSettings(agentDir, { ...DEFAULT_CONTEXT_HINT_SETTINGS, expanded: false });

		const { default: registerContextHint } = await import("../extensions/context-hint");
		registerContextHint(pi as any);
		await listeners.get("session_start")!({ reason: "resume" }, ctx);
		expect(notifications).toEqual([]);
		await commands.get("context-hint")!("", ctx);
		expect(menuChoices.at(-1)).toContain("toggle — Expand or collapse cards (Alt+O)");
		expect(notifications).toEqual([]);
		await commands.get("context-hint")!("status", ctx);
		expect(notifications.at(-1)?.level).toBe("info");
		expect(notifications.at(-1)?.message).toContain("Context Hint enabled; summary model inherit current (no active model); thinking unavailable");
		expect(notifications.at(-1)?.message).toContain("Shortcut: Alt+O — expand/collapse cards");
		expect([...timers.values()].map(({ delay }) => delay)).toEqual([8_000]);
		expect(statuses.get("context-hint")).toContain("⢄⣀⡠ context-hint: collapsed");

		const oldError = { ...pendingRecord(), generationId: "old-error", sessionId: "first", status: "error" as const, error: "old failure" };
		await writeGeneration(paths, oldError);
		entries.push({ type: "custom", customType: ENTRY_TYPE, data: { kind: "hint", generationId: oldError.generationId } });
		await listeners.get("session_tree")!({}, ctx);
		expect(statuses.get("context-hint")).toContain("⢄⣀⡠ context-hint: error");
		expect([...timers.values()].map(({ delay }) => delay)).toEqual([8_000]);

		const staleTimer = [...timers.values()][0];
		sessionId = "second";
		await listeners.get("session_start")!({ reason: "resume" }, ctx);
		staleTimer.callback();
		expect([...timers.values()].map(({ delay }) => delay)).toEqual([8_000]);
		expect(statuses.get("context-hint")).toContain("⢄⣀⡠ context-hint: error");

		const activePending = { ...pendingRecord(), generationId: "active-pending", sessionId: "second" };
		await writeGeneration(paths, activePending);
		entries.push({ type: "custom", customType: ENTRY_TYPE, data: { kind: "hint", generationId: activePending.generationId } });
		await listeners.get("session_tree")!({}, ctx);
		expect(statuses.get("context-hint")).toContain("⢄⣀⡠ context-hint: generating");
		expect([...timers.values()].map(({ delay }) => delay).sort((a, b) => a - b)).toEqual([80, 8_000]);

		fireTimer(8_000);
		expect(statuses.get("context-hint")).toContain("⠠⡤⠄ context-hint: generating");
		expect(statuses.get("context-hint")).not.toContain(eyeGlyph("half"));
		expect(statuses.get("context-hint")).not.toContain(eyeGlyph("open"));
		expect([...timers.values()].map(({ delay }) => delay).sort((a, b) => a - b)).toEqual([80, 300]);
		fireTimer(300);
		expect(statuses.get("context-hint")).toContain("⢄⣀⡠ context-hint: generating");
		expect([...timers.values()].map(({ delay }) => delay).sort((a, b) => a - b)).toEqual([80, 8_000]);

		await commands.get("context-hint")!("motion reduce", ctx);
		expect(timers.size).toBe(0);
		expect(statuses.get("context-hint")).toContain("⢄⣀⡠ context-hint: generating");
		await commands.get("context-hint")!("motion animate", ctx);
		expect([...timers.values()].map(({ delay }) => delay).sort((a, b) => a - b)).toEqual([80, 8_000]);
		await commands.get("context-hint")!("disable", ctx);
		expect(timers.size).toBe(0);
		expect(statuses.get("context-hint")).toContain("⢄⣀⡠ context-hint: disabled");
		await commands.get("context-hint")!("status", ctx);
		expect(notifications.at(-1)?.message).toContain("Shortcut: Alt+O — expand/collapse cards");
		expect(notifications.at(-1)?.message).toContain("Context Hint generation is disabled; existing cards can still be expanded or collapsed.");
		const beforeEnableNotices = notifications.length;
		await commands.get("context-hint")!("enable", ctx);
		expect(notifications.slice(beforeEnableNotices)).toEqual([
			{ message: "Context Hint enabled; summary model inherit current (no active model); thinking unavailable.\nAlt+O toggles cards.\nNext settled interaction generates a card.", level: "info" },
		]);
		expect([...timers.values()].map(({ delay }) => delay)).toEqual([8_000]);
		expect(statuses.get("context-hint")).toContain("⢄⣀⡠ context-hint: error");

		const readyRecord: GenerationRecord = {
			...pendingRecord(),
			generationId: "expanded-ready",
			sessionId: "second",
			status: "ready",
			hint: emptyHint(),
			sessionState: EMPTY_SESSION_STATE,
			projectState: EMPTY_PROJECT_STATE,
		};
		await writeGeneration(paths, readyRecord);
		entries.push({ type: "custom", customType: ENTRY_TYPE, data: { kind: "hint", generationId: readyRecord.generationId } });
		await listeners.get("session_tree")!({}, ctx);
		const expectStatusEye = (phase: "open" | "half" | "slit" | "closed") => {
			expect(statuses.get("context-hint")!.startsWith(eyeGlyph(phase))).toBe(true);
		};
		const expectEyesMatch = (phase: "open" | "half" | "slit" | "closed") => {
			expectStatusEye(phase);
			const card = renderers.get(ENTRY_TYPE)!({ data: { kind: "hint", generationId: readyRecord.generationId } }, {}, theme);
			expect(card.render(48)[0]).toContain(`${eyeGlyph(phase)} CONTEXT HINT`);
		};
		const beforeKeyboardToggleNotices = notifications.length;
		await shortcuts.get("alt+o")!(ctx);
		expectEyesMatch("closed");
		for (const phase of ["slit", "half", "open", "open"] as const) {
			fireTimer(80);
			expectEyesMatch(phase);
		}
		expect([...timers.values()].map(({ delay }) => delay)).toEqual([5_000]);
		const cardTheme = { ...theme, fg: (_color: string, text: string) => `\x1b[31m${text}\x1b[39m` };
		const historyCard = renderers.get(ENTRY_TYPE)!({ data: { kind: "hint", generationId: readyRecord.generationId } }, {}, cardTheme);
		const visibleCard = renderers.get(ENTRY_TYPE)!({ data: { kind: "hint", generationId: readyRecord.generationId } }, {}, cardTheme);
		tui.addChild(historyCard);
		let historyText = "History line";
		tui.addChild({ invalidate() {}, render: () => Array.from({ length: 40 }, (_, i) => `${historyText} ${i}`) });
		tui.addChild(visibleCard);
		let appendedLine = "";
		tui.addChild({ invalidate() {}, render: () => appendedLine ? [appendedLine] : [] });
		tui.addChild({ invalidate() {}, render: () => [statuses.get("context-hint")!] });
		tui.renderNow();
		const historyTitle = tui.captureRenderState().previousLines[0];
		const visibleTitleRow = historyCard.render(80).length + 40;
		expect(visibleTitleRow).toBeGreaterThanOrEqual(tui.captureRenderState().previousViewportTop);
		const redrawsBeforeBlink = tui.fullRedraws;
		terminalWrites.length = 0;
		fireTimer(5_000);
		expectEyesMatch("open");
		const staleBlink = [...timers.values()].find(({ delay, interval }) => delay === 80 && interval)!;
		for (const phase of ["half", "slit", "closed", "slit", "half", "open", "open"] as const) {
			fireTimer(80);
			expectEyesMatch(phase);
			if (phase === "closed") appendedLine = "New streamed output";
			tui.renderNow();
			expect(tui.fullRedraws).toBe(redrawsBeforeBlink);
			expect(terminalWrites.join("")).not.toContain("\x1b[3J");
			expect(tui.captureRenderState().previousLines[0]).toBe(historyTitle);
			expect(stripTerminalSequences(tui.captureRenderState().previousLines[visibleTitleRow])).toContain(`${eyeGlyph(phase)} CONTEXT HINT`);
		}

		expect(tui.captureRenderState().previousLines.some((line) => line.includes("New streamed output"))).toBe(true);
		historyText = "Updated history";
		tui.renderNow();
		expect(tui.captureRenderState().previousLines.some((line) => line.includes("Updated history"))).toBe(true);
		expect(tui.fullRedraws).toBeGreaterThan(redrawsBeforeBlink);

		await shortcuts.get("alt+o")!(ctx);
		expectStatusEye("open");
		for (const phase of ["half", "slit", "closed", "closed"] as const) {
			fireTimer(80);
			expectStatusEye(phase);
		}
		expect([...timers.values()].map(({ delay }) => delay)).toEqual([8_000]);
		sessionId = "third";
		await listeners.get("session_start")!({ reason: "resume" }, ctx);
		staleBlink.callback();
		expectStatusEye("closed");
		expect([...timers.values()].map(({ delay }) => delay)).toEqual([8_000]);
		expect(notifications).toHaveLength(beforeKeyboardToggleNotices);

		await shortcuts.get("alt+o")!(ctx);
		await commands.get("context-hint")!("disable", ctx);
		tui.renderNow();
		expect(stripTerminalSequences(tui.captureRenderState().previousLines[0])).toContain(`${eyeGlyph("closed")} CONTEXT HINT`);
		expect(timers.size).toBe(0);
		expect(statuses.get("context-hint")).toContain("⢄⣀⡠ context-hint: disabled");
		expectEyesMatch("closed");
		await commands.get("context-hint")!("status", ctx);
		expect(notifications.at(-1)?.message).toContain("Shortcut: Alt+O — expand/collapse cards");
		expect(notifications.at(-1)?.message).toContain("Context Hint generation is disabled; existing cards can still be expanded or collapsed.");
		const beforeCommandToggleNotices = notifications.length;
		await commands.get("context-hint")!("toggle", ctx);
		expect(notifications).toHaveLength(beforeCommandToggleNotices);
		expectStatusEye("closed");
		await commands.get("context-hint")!("toggle", ctx);
		expect(notifications).toHaveLength(beforeCommandToggleNotices);
		expectEyesMatch("closed");
		await commands.get("context-hint")!("motion reduce", ctx);
		expectEyesMatch("closed");
		expect(timers.size).toBe(0);
		await shortcuts.get("alt+o")!(ctx);
		expectStatusEye("closed");
		expect(timers.size).toBe(0);
		await shortcuts.get("alt+o")!(ctx);
		expectEyesMatch("closed");
		expect(timers.size).toBe(0);
		const beforeReducedEnableNotices = notifications.length;
		await commands.get("context-hint")!("enable", ctx);
		expect(notifications.slice(beforeReducedEnableNotices)).toEqual([
			{ message: "Context Hint enabled; summary model inherit current (no active model); thinking unavailable.\nAlt+O toggles cards.\nNext settled interaction generates a card.", level: "info" },
		]);
		expectEyesMatch("open");
		expect(timers.size).toBe(0);
		const beforeReducedShortcutNotices = notifications.length;
		await shortcuts.get("alt+o")!(ctx);
		expectStatusEye("closed");
		expect(notifications).toHaveLength(beforeReducedShortcutNotices);
		expect(timers.size).toBe(0);

		await listeners.get("session_shutdown")!({ reason: "exit" }, ctx);
		expect(tui.render).toBe(originalRender);
		expect(timers.size).toBe(0);
		expect(statuses.has("context-hint")).toBe(false);
	} finally {
		Math.random = originalRandom;
		globalThis.setTimeout = originalSetTimeout;
		globalThis.clearTimeout = originalClearTimeout;
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		await rm(temp, { recursive: true, force: true });
	}
});

function emptyHint() {
	return {
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
		attentionCue: { level: "none" as const },
	};
}

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
