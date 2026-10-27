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
	readGeneration,
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

test("corrects an explicitly rejected Off level to an advertised Low level", async () => {
	const model = {
		provider: "openai",
		id: "summary",
		api: "openai-responses",
		baseUrl: "https://api.example.test/v1",
		reasoning: true,
		thinkingLevelMap: { off: "none", low: "low", medium: "medium", high: "high" },
	} as any;
	const requests: Array<{ request: any; options: any }> = [];
	const warnings: Array<[string, string, boolean]> = [];
	const ctx = {
		ui: { notify() {} },
		modelRegistry: {
			streamSimple: (_model: unknown, request: any, options: any) => {
				requests.push({ request, options });
				return {
					result: async () => requests.length === 1
						? {
							stopReason: "error",
							errorMessage: `OpenAI API error (400): ${JSON.stringify({
								code: "unsupported_value",
								param: "reasoning.effort",
								type: "invalid_request_error",
								message: "Unsupported value: 'none' is not supported with the 'summary' model. Supported values are: 'low', 'medium', and 'high'.",
							})}`,
							content: [],
						}
						: { stopReason: "toolUse", content: [{ type: "text", text: JSON.stringify(emptyHint()) }] },
				};
			},
		},
	} as any;
	const recovery = {
		isCurrent: () => true,
		getAcceptedLevel: () => undefined,
		warn: (rejected: string, replacement: string, lowest: boolean) => warnings.push([rejected, replacement, lowest]),
		accepted() {},
		invalidate() {},
	};
	const evidence = {
		schemaVersion: 1 as const,
		capturedAt: "2026-09-15T00:00:00.000Z",
		userPrompt: "recover summary thinking",
		assistantText: "",
		imageCount: 0,
		tools: [],
		knownPaths: [],
		projectFacts: [],
	};

	const hint = await (generateHint as any)(ctx, model, evidence, EMPTY_SESSION_STATE, EMPTY_PROJECT_STATE, new AbortController().signal, "off", recovery);

	expect(hint).toEqual(emptyHint());
	expect(requests).toHaveLength(2);
	expect(requests.map(({ options }) => options.reasoning)).toEqual([undefined, "low"]);
	expect(requests[1].request.messages[0].content[0].text).toBe(requests[0].request.messages[0].content[0].text);
	expect(warnings).toEqual([["off", "low", true]]);
});

test("chooses corrections from the model mapping and advertised wire values", async () => {
	const model = recoveryTestModel({
		thinkingLevelMap: {
			off: "none",
			low: "reasoning-small",
			medium: "reasoning-balanced",
			high: "reasoning-deep",
			max: "reasoning-max",
		},
	});
	const requests: Array<{ request: any; options: any }> = [];
	const ctx = mockSummaryContext([
		providerError(unsupportedValueError("reasoning-max", "summary", ["reasoning-small", "reasoning-balanced", "reasoning-deep"])),
		completedSummary(emptyHint()),
	], requests);
	const warnings: Array<[string, string, boolean]> = [];

	await (generateHint as any)(ctx, model, summaryEvidence(), EMPTY_SESSION_STATE, EMPTY_PROJECT_STATE, new AbortController().signal, "max", recoveryHooks({
		warn: (rejected: string, replacement: string, lowest: boolean) => warnings.push([rejected, replacement, lowest]),
	}));

	expect(requests.map(({ options }) => options.reasoning)).toEqual(["max", "high"]);
	expect(warnings).toEqual([["max", "high", false]]);
});

test("uses the lowest advertised level when none is below the requested level", async () => {
	const requests: Array<{ request: any; options: any }> = [];
	const ctx = mockSummaryContext([
		providerError(unsupportedValueError("low", "summary", ["medium", "high"])),
		completedSummary(emptyHint()),
	], requests);
	await generateHint(ctx, recoveryTestModel(), summaryEvidence(), EMPTY_SESSION_STATE, EMPTY_PROJECT_STATE, new AbortController().signal, "low");
	expect(requests.map(({ options }) => options.reasoning)).toEqual(["low", "medium"]);
});

test("status distinguishes requested thinking from the session's effective level", async () => {
	const harness = await createToolEvidenceHarness({ responses: [
		providerError(unsupportedValueError("none", "summary", ["low", "medium"])),
		completedSummary(emptyHint()),
	] });
	try {
		harness.beforeAgentStart("recover summary");
		await harness.settle();
		await harness.waitForLatestRecord();
		await harness.command("status");
		expect(harness.notifications.at(-1)?.message).toContain("thinking low (requested off; effective for this session)");
	} finally {
		await harness.close();
	}
});

test("unknown, malformed, and unrelated provider failures do not correct thinking", async () => {
	const model = recoveryTestModel();
	const cases = [
		providerError("Unsupported value: none is not supported. Supported values are low, medium."),
		providerError(unsupportedValueError("none", "summary", ["low", "medium"]).replace("unsupported_value", "invalid_request")),
		providerError(unsupportedValueError("none", "summary", ["low", "medium"]).replace("'low' and 'medium'", "'low', 'medium'")),
		providerError(unsupportedValueError("none", "summary", ["low", "medium"]).replace("reasoning.effort", "temperature")),
		providerError("401 Unauthorized: invalid_api_key"),
		providerError("429 Too Many Requests: rate limit exceeded"),
		providerError("TypeError: fetch failed"),
		{ stopReason: "length", errorMessage: "Response incomplete: max_output_tokens", content: [] },
	];
	for (const response of cases) {
		const requests: Array<{ request: any; options: any }> = [];
		const warnings: unknown[] = [];
		const ctx = mockSummaryContext([response], requests);
		await expect((generateHint as any)(ctx, model, summaryEvidence(), EMPTY_SESSION_STATE, EMPTY_PROJECT_STATE, new AbortController().signal, "off", recoveryHooks({
			warn: (...args: unknown[]) => warnings.push(args),
		}))).rejects.toThrow();
		expect(requests).toHaveLength(1);
		expect(warnings).toEqual([]);
	}
});

test("correction and format repair use one shared two-request budget", async () => {
	const model = recoveryTestModel();
	const correctedRequests: Array<{ request: any; options: any }> = [];
	const corrected = mockSummaryContext([
		providerError(unsupportedValueError("none", "summary", ["low", "medium"])),
		{ stopReason: "toolUse", content: [{ type: "text", text: "not JSON" }] },
	], correctedRequests);
	await expect((generateHint as any)(corrected, model, summaryEvidence(), EMPTY_SESSION_STATE, EMPTY_PROJECT_STATE, new AbortController().signal, "off", recoveryHooks()))
		.rejects.toThrow("invalid Context Hint");
	expect(correctedRequests).toHaveLength(2);
	expect(correctedRequests[1].request.messages[0].content[0].text).toBe(correctedRequests[0].request.messages[0].content[0].text);

	const repairRequests: Array<{ request: any; options: any }> = [];
	const repair = mockSummaryContext([
		{ stopReason: "toolUse", content: [{ type: "text", text: "not JSON" }] },
		providerError(unsupportedValueError("none", "summary", ["low", "medium"])),
	], repairRequests);
	await expect((generateHint as any)(repair, model, summaryEvidence(), EMPTY_SESSION_STATE, EMPTY_PROJECT_STATE, new AbortController().signal, "off", recoveryHooks()))
		.rejects.toThrow("unsupported_value");
	expect(repairRequests).toHaveLength(2);
	expect(repairRequests[1].request.messages[0].content[0].text).toContain("\n\nREPAIR:");
});

test("does not correct or learn after cancellation or a stale response", async () => {
	const model = recoveryTestModel();
	const evidence = summaryEvidence();
	const controller = new AbortController();
	const requests: Array<{ request: any; options: any }> = [];
	const callbacks: string[] = [];
	const cancelled = mockSummaryContext([providerError(unsupportedValueError("none", "summary", ["low", "medium"]))], requests, () => controller.abort());
	await expect((generateHint as any)(cancelled, model, evidence, EMPTY_SESSION_STATE, EMPTY_PROJECT_STATE, controller.signal, "off", recoveryHooks({
		warn: () => callbacks.push("warn"),
		accepted: () => callbacks.push("accepted"),
		invalidate: () => callbacks.push("invalidate"),
	}))).rejects.toThrow("Generation aborted");
	expect(requests).toHaveLength(1);
	expect(callbacks).toEqual([]);

	let current = true;
	const staleRequests: Array<{ request: any; options: any }> = [];
	const stale = mockSummaryContext([completedSummary(emptyHint())], staleRequests, () => { current = false; });
	await expect((generateHint as any)(stale, model, evidence, EMPTY_SESSION_STATE, EMPTY_PROJECT_STATE, new AbortController().signal, "low", recoveryHooks({
		isCurrent: () => current,
		accepted: () => callbacks.push("accepted"),
	}))).rejects.toThrow("no longer current");
	expect(staleRequests).toHaveLength(1);
	expect(callbacks).toEqual([]);
});

test("runGeneration learns accepted thinking before validation and reuses it without another warning", async () => {
	const model = recoveryTestModel();
	const harness = await createToolEvidenceHarness({
		model,
		responses: [
			providerError(unsupportedValueError("none", "summary", ["low", "medium"])),
			{ stopReason: "toolUse", content: [{ type: "text", text: "not JSON" }] },
			{ stopReason: "toolUse", content: [{ type: "text", text: "not JSON" }] },
			completedSummary(emptyHint()),
		],
	});
	try {
		harness.beforeAgentStart("first summary");
		await harness.settle();
		const first = await harness.waitForLatestRecord();
		expect(first.status).toBe("error");
		expect(first.hint).toBeUndefined();
		expect(first.error).toContain("invalid Context Hint");
		expect(harness.notifications).toEqual([{
			message: "Current summary model does not support thinking Off. Retrying with Low, its lowest supported level.",
			level: "warning",
		}]);

		harness.beforeAgentStart("second summary");
		await harness.settle();
		const second = await harness.waitForLatestRecord();
		expect(second.status).toBe("ready");
		expect(harness.requestOptions.map((options: any) => options.reasoning)).toEqual([undefined, "low", "low", "low"]);
		expect(harness.requests[1].messages[0].content[0].text).toBe(harness.requests[0].messages[0].content[0].text);
		expect(harness.requests[2].messages[0].content[0].text).not.toContain("\n\nREPAIR:");
		expect(harness.requests[3].messages[0].content[0].text).toContain("\n\nREPAIR:");
		expect(harness.notifications).toHaveLength(1);
		expect(harness.events).toEqual(["request:1", "warning", "request:2", "request:3", "request:4"]);
	} finally {
		await harness.close();
	}
});

test("scopes accepted levels to a stable model endpoint", async () => {
	for (const baseUrl of [undefined, "https://user:secret@api.example.test/v1", "https://api.example.test/v1?token=secret"]) {
		const harness = await createToolEvidenceHarness({
			model: recoveryTestModel({ baseUrl }),
			responses: [
				providerError(unsupportedValueError("none", "summary", ["low", "medium"])),
				completedSummary(emptyHint()),
				providerError(unsupportedValueError("none", "summary", ["low", "medium"])),
				completedSummary(emptyHint()),
			],
		});
		try {
			for (const prompt of ["first endpoint request", "second endpoint request"]) {
				harness.beforeAgentStart(prompt);
				await harness.settle();
				expect((await harness.waitForLatestRecord()).status).toBe("ready");
			}
			expect(harness.requestOptions.map((options: any) => options.reasoning)).toEqual([undefined, "low", undefined, "low"]);
			expect(harness.notifications).toHaveLength(2);
		} finally {
			await harness.close();
		}
	}

	const model = recoveryTestModel();
	const harness = await createToolEvidenceHarness({
		model,
		responses: [
			providerError(unsupportedValueError("none", "summary", ["low", "medium"])),
			completedSummary(emptyHint()),
			providerError(unsupportedValueError("none", "summary", ["low", "medium"])),
			completedSummary(emptyHint()),
		],
	});
	try {
		harness.beforeAgentStart("original endpoint");
		await harness.settle();
		expect((await harness.waitForLatestRecord()).status).toBe("ready");
		model.baseUrl = "https://other.example.test/v1";
		harness.beforeAgentStart("changed endpoint");
		await harness.settle();
		expect((await harness.waitForLatestRecord()).status).toBe("ready");
		expect(harness.requestOptions.map((options: any) => options.reasoning)).toEqual([undefined, "low", undefined, "low"]);
		expect(harness.notifications).toHaveLength(2);
	} finally {
		await harness.close();
	}
});

test("invalidates a cached level when the provider later rejects it", async () => {
	const harness = await createToolEvidenceHarness({
		model: recoveryTestModel(),
		responses: [
			providerError(unsupportedValueError("none", "summary", ["low", "medium"])),
			completedSummary(emptyHint()),
			providerError(unsupportedValueError("low", "summary", ["medium", "high"])),
			completedSummary(emptyHint()),
		],
	});
	try {
		harness.beforeAgentStart("learn Low");
		await harness.settle();
		expect((await harness.waitForLatestRecord()).status).toBe("ready");

		harness.beforeAgentStart("reject cached Low");
		await harness.settle();
		expect((await harness.waitForLatestRecord()).status).toBe("ready");
		expect(harness.requestOptions.map((options: any) => options.reasoning)).toEqual([undefined, "low", "low", "medium"]);
		expect(harness.notifications.map(({ message }: { message: string }) => message)).toEqual([
			"Current summary model does not support thinking Off. Retrying with Low, its lowest supported level.",
			"Current summary model does not support thinking Low. Retrying with Medium, its lowest supported level.",
		]);
	} finally {
		await harness.close();
	}
});

test("a cancelled generation cannot teach the next summary a stale accepted level", async () => {
	let finishCancelled!: (response: unknown) => void;
	const cancelledResponse = new Promise((resolve) => { finishCancelled = resolve; });
	const harness = await createToolEvidenceHarness({
		model: recoveryTestModel(),
		responses: [
			() => cancelledResponse,
			providerError(unsupportedValueError("none", "summary", ["low", "medium"])),
			completedSummary(emptyHint()),
		],
	});
	try {
		harness.beforeAgentStart("cancelled summary");
		await harness.beginSettlement();
		await harness.waitForRequestCount(1);
		await harness.listeners.get("session_before_tree")!({}, harness.ctx);
		finishCancelled(providerError(unsupportedValueError("none", "summary", ["low", "medium"])));
		await harness.waitForLatestRecord();

		harness.beforeAgentStart("current summary");
		await harness.beginSettlement();
		await harness.waitForRequestCount(3);
		const record = await harness.waitForLatestRecord();
		expect(record.status).toBe("ready");
		expect(harness.requestOptions.map((options: any) => options.reasoning)).toEqual([undefined, undefined, "low"]);
		expect(harness.notifications).toHaveLength(1);
	} finally {
		await harness.close();
	}
});

test("a corrected second response records an error without an empty ready hint", async () => {
	const harness = await createToolEvidenceHarness({
		model: recoveryTestModel(),
		responses: [
			providerError(unsupportedValueError("none", "summary", ["low", "medium"])),
			providerError("500: provider unavailable with sk-live-secret"),
		],
	});
	try {
		harness.beforeAgentStart("failed corrected summary");
		await harness.settle();
		const record = await harness.waitForLatestRecord();
		expect(record.status).toBe("error");
		expect(record.hint).toBeUndefined();
		expect(record.error).toContain("provider unavailable");
		expect(record.error).not.toContain("sk-live-secret");
		expect(contextHintCard(() => record, () => 0, true, theme).render(80).join("\n")).toContain("ERROR");
		expect(harness.requests).toHaveLength(2);
	} finally {
		await harness.close();
	}
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

test("throws after two unusable responses instead of returning an empty hint", async () => {
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
	).rejects.toThrow("Expected one tool call or JSON text");
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

test("registered tool events retain completion and failure evidence by call id", async () => {
	const harness = await createToolEvidenceHarness();
	try {
		harness.beforeAgentStart("finish the tool run");
		for (let index = 0; index < 30; index++) {
			const args = { path: `src/tool-${index}.ts`, api_key: "sk-per3-evidence-secret" };
			harness.startTool(`call-${index}`, `tool-${index}`, args);
			if (index === 29) args.path = "src/mutated-after-start.ts";
		}
		for (let index = 29; index >= 0; index--) {
			harness.endTool(`call-${index}`, `tool-${index}`, `result-${index}`, index >= 18);
		}
		harness.startTool("last-failure", "trailing-failure", { path: "src/trailing-failure.ts" });
		harness.endTool("last-failure", "trailing-failure", "last failure", true);
		harness.endTool("call-25", "tool-25", "late duplicate", false);

		const { payload } = parseSummaryRequest(await harness.settle());
		const tools = payload.turnEvidence.tools;
		expect(tools).toHaveLength(24);
		expect(tools.map((tool: any) => tool.name)).toEqual([
			...Array.from({ length: 4 }, (_, offset) => `tool-${29 - offset}`),
			...Array.from({ length: 7 }, (_, offset) => `tool-${24 - offset}`),
			"tool-11",
			...Array.from({ length: 11 }, (_, offset) => `tool-${10 - offset}`),
			"trailing-failure",
		]);
		expect(tools.filter((tool: any) => !tool.ok)).toHaveLength(12);
		expect(tools.at(-1)).toMatchObject({ name: "trailing-failure", ok: false, result: "last failure" });
		expect(tools[0]).toMatchObject({
			name: "tool-29",
			ok: false,
			input: '{"path":"src/tool-29.ts","api_key":"[REDACTED]"}',
			result: "result-29",
		});
		expect(payload.turnEvidence.knownPaths).toContain("nested/src/tool-0.ts");
		expect(payload.turnEvidence.knownPaths).not.toContain("nested/src/tool-29.ts");
		expect(payload.turnEvidence.tools.some((tool: any) => tool.result === "late duplicate")).toBe(false);
	} finally {
		await harness.close();
	}
});

test("overlapping retention windows refill one unique 24-fact pool", async () => {
	const harness = await createToolEvidenceHarness();
	try {
		harness.beforeAgentStart("run many failures");
		for (let index = 1; index <= 30; index++) {
			harness.startTool(`call-${index}`, `tool-${index}`, { path: `src/tool-${index}.ts` });
		}
		for (let index = 1; index <= 30; index++) {
			harness.endTool(`call-${index}`, `tool-${index}`, `failure-${index}`, true);
		}

		const { payload } = parseSummaryRequest(await harness.settle());
		const names = payload.turnEvidence.tools.map((tool: any) => tool.name);
		expect(names).toEqual([
			...Array.from({ length: 4 }, (_, offset) => `tool-${offset + 1}`),
			...Array.from({ length: 20 }, (_, offset) => `tool-${offset + 11}`),
		]);
		expect(new Set(names).size).toBe(24);
		expect(payload.turnEvidence.tools).toHaveLength(24);
		expect(payload.turnEvidence.tools.filter((tool: any) => !tool.ok)).toHaveLength(24);
	} finally {
		await harness.close();
	}
});

test("failure and recovery remain separate from current blockers", async () => {
	const harness = await createToolEvidenceHarness();
	try {
		harness.beforeAgentStart("recover test failure");
		harness.startTool("failed", "test", { path: "src/broken.ts" });
		harness.endTool("failed", "test", "test suite failed", true);
		harness.startTool("unrelated", "read", { path: "README.md" });
		harness.endTool("unrelated", "read", "read project notes", false);
		harness.startTool("recovery", "edit", { path: "src/fixed.ts" });
		harness.endTool("recovery", "edit", "test suite passed", false);

		const { payload } = parseSummaryRequest(await harness.settle());
		expect(payload.turnEvidence.tools.map((tool: any) => [tool.name, tool.ok, tool.result])).toEqual([
			["test", false, "test suite failed"],
			["read", true, "read project notes"],
			["edit", true, "test suite passed"],
		]);
		expect(payload.priorSessionState.blockers).toEqual([]);
	} finally {
		await harness.close();
	}
});

test("settled capture swaps before file reads and ignores late tool ends", async () => {
	const harness = await createToolEvidenceHarness();
	try {
		harness.beforeAgentStart("old turn");
		harness.startTool("old-call", "old-tool", { path: "src/old.ts" });
		harness.endTool("old-call", "old-tool", "old result", false);
		harness.startTool("late-call", "late-tool", { path: "src/late.ts" });
		const firstSettlement = harness.beginSettlement();

		harness.beforeAgentStart("new turn");
		harness.endTool("late-call", "late-tool", "late old result", true);
		harness.startTool("new-call", "new-tool", { path: "src/new.ts" });
		harness.endTool("new-call", "new-tool", "new result", false);
		await firstSettlement;
		await harness.waitForRequestCount(1);

		const secondRequest = await harness.settle();
		const firstTools = parseSummaryRequest(harness.requests[0]).payload.turnEvidence.tools;
		const secondTools = parseSummaryRequest(secondRequest).payload.turnEvidence.tools;
		expect(firstTools.map((tool: any) => [tool.name, tool.result])).toEqual([["old-tool", "old result"]]);
		expect(secondTools.map((tool: any) => [tool.name, tool.result])).toEqual([["new-tool", "new result"]]);
	} finally {
		await harness.close();
	}
});

test("session changes discard pending inputs before late results arrive", async () => {
	const harness = await createToolEvidenceHarness();
	try {
		harness.startTool("stale-call", "stale-tool", { path: "src/stale.ts" });
		await harness.startSession("new-session");
		harness.endTool("stale-call", "stale-tool", "stale result", true);
		harness.startTool("current-call", "current-tool", { path: "src/current.ts" });
		harness.endTool("current-call", "current-tool", "current result", false);

		const { payload } = parseSummaryRequest(await harness.settle());
		expect(payload.turnEvidence.tools.map((tool: any) => [tool.name, tool.result])).toEqual([["current-tool", "current result"]]);
	} finally {
		await harness.close();
	}
});

test("unmatched tool ends do not create evidence", async () => {
	const harness = await createToolEvidenceHarness();
	try {
		harness.beforeAgentStart("no tools completed");
		harness.endTool("missing-start", "orphan", "orphan result", true);
		const { payload } = parseSummaryRequest(await harness.settle());
		expect(payload.turnEvidence.tools).toEqual([]);
		expect(payload.turnEvidence.knownPaths).toEqual([]);
	} finally {
		await harness.close();
	}
});

test("summary packing keeps valid redacted JSON, current blockers, and actual code-cue paths", async () => {
	const evidence = {
		schemaVersion: 1 as const,
		capturedAt: "2026-09-15T00:00:00.000Z",
		userPrompt: `USER_PROMPT_PIN ${'quote " slash \\ 💡 '.repeat(800)}`,
		assistantText: `ASSISTANT_BACKGROUND ${"assistant ".repeat(900)}`,
		imageCount: 0,
		tools: Array.from({ length: 24 }, (_, index) => ({
			name: index === 23 ? "latest" : `tool-${index}`,
			ok: true,
			input: `input-${index} ${"i".repeat(690)}`,
			result: index === 23 ? "LATEST_RESULT_PIN" : `result-${index} ${"r".repeat(980)}`,
			paths: [`src/tool-${index}.ts`],
		})),
		knownPaths: Array.from({ length: 24 }, (_, index) => `src/tool-${index}.ts`),
		projectFacts: [{ path: "CONTEXT.md", excerpt: `PROJECT_FILE_BACKGROUND ${"file ".repeat(900)}` }],
	};
	const sessionState = {
		goal: `SESSION_GOAL_PIN api_key="sk-per3-secret" ${"goal ".repeat(600)}`,
		currentFocus: "CURRENT_FOCUS_PIN",
		currentHypothesis: "CURRENT_HYPOTHESIS_PIN",
		status: "blocked" as const,
		openLoops: ["OPEN_LOOP_PIN"],
		ruledOut: ["RULED_OUT_PIN"],
		blockers: [`CURRENT_BLOCKER_PIN ${"blocker ".repeat(500)}`],
		nextSteps: [`CURRENT_NEXT_STEP_PIN ${"next ".repeat(500)}`],
	};
	const projectState = {
		summary: `PROJECT_SUMMARY_BACKGROUND ${"summary ".repeat(700)}`,
		purpose: "PROJECT_PURPOSE_PIN",
		architecture: [`ARCHITECTURE_BACKGROUND ${"architecture ".repeat(300)}`],
		constraints: ["PROJECT_CONSTRAINT_PIN"],
		conventions: ["PROJECT_CONVENTION_PIN"],
		importantDecisions: [{ decision: "PROJECT_DECISION_PIN", rationale: "PROJECT_RATIONALE_PIN" }],
		currentPhase: "PROJECT_PHASE_PIN",
	};
	const originals = structuredClone({ evidence, sessionState, projectState });
	const requests: any[] = [];
	let droppedPath: string | undefined;
	const model = { provider: "test", id: "summary", api: "openai-responses", reasoning: true } as any;
	const ctx = {
		modelRegistry: {
			streamSimple: (_model: unknown, request: any) => {
				requests.push(request);
				const text = request.messages[0].content[0].text;
				const prefix = text.split("\n\nREPAIR:")[0];
				let payload: any;
				try {
					payload = JSON.parse(prefix);
				} catch {}
				const calls = requests.length;
				if (calls === 1) {
					droppedPath = evidence.knownPaths.find((path) => !payload?.turnEvidence.knownPaths.includes(path));
					const invalid = emptyHint();
					invalid.turnDelta.codeCues = [{ path: droppedPath ?? "src/not-sent.ts", kind: "verified", reason: "not in request" }] as any;
					return { result: async () => ({ content: [{ type: "text", text: JSON.stringify(invalid) }] }) };
				}
				const valid = emptyHint();
				const knownPath = payload.turnEvidence.knownPaths.at(-1);
				valid.turnDelta.codeCues = [{ path: knownPath, kind: "verified", reason: "sent evidence" }] as any;
				return { result: async () => ({ content: [{ type: "text", text: JSON.stringify(valid) }] }) };
			},
		},
	} as any;

	const hint = await generateHint(
		ctx,
		model,
		evidence as any,
		sessionState as any,
		projectState as any,
		new AbortController().signal,
	);

	expect(requests).toHaveLength(2);
	const firstText = requests[0].messages[0].content[0].text;
	const repairText = requests[1].messages[0].content[0].text;
	const repairPrefix = repairText.slice(0, repairText.indexOf("\n\nREPAIR:"));
	expect(firstText.length).toBeLessThanOrEqual(20_000);
	expect(repairText.length).toBeLessThanOrEqual(20_000);
	const firstPayload = JSON.parse(firstText);
	const repairPayload = JSON.parse(repairPrefix);
	expect(repairPayload).toEqual(firstPayload);
	expect(firstPayload.turnEvidence.tools.at(-1)).toMatchObject({ name: "latest", ok: true, result: "LATEST_RESULT_PIN" });
	expect(firstPayload.turnEvidence.tools.length).toBeLessThan(24);
	expect(firstPayload.turnEvidence.knownPaths).toEqual(
		[...new Set(firstPayload.turnEvidence.tools.filter((tool: any) => tool.ok).flatMap((tool: any) => tool.paths))].sort(),
	);
	expect(droppedPath).toBeDefined();
	expect(firstPayload.coverage).toEqual({
		tools: "partial",
		toolText: "partial",
		session: "partial",
		project: "partial",
		conversation: "partial",
	});
	expect(requests[0].systemPrompt).toContain("Partial evidence cannot prove that a fact is absent");
	expect(firstPayload.turnEvidence.userPrompt).toContain("USER_PROMPT_PIN");
	expect(firstPayload.priorSessionState.blockers[0]).toContain("CURRENT_BLOCKER_PIN");
	expect(firstPayload.priorSessionState.blockers).not.toEqual([]);
	expect(firstText).not.toContain("sk-per3-secret");
	expect(hint.turnDelta.codeCues).toEqual([{ path: firstPayload.turnEvidence.knownPaths.at(-1), kind: "verified", reason: "sent evidence" }]);
	expect({ evidence, sessionState, projectState }).toEqual(originals);
});

test("repair requests stay within the summary message budget", async () => {
	const requests: any[] = [];
	let attempts = 0;
	const valid = emptyHint();
	const ctx = {
		modelRegistry: {
			streamSimple: (_model: unknown, request: any) => {
				requests.push(request);
				attempts++;
				return {
					result: async () => {
						if (attempts === 1) return { content: [{ type: "text", text: "not JSON" }] };
						return { content: [{ type: "text", text: JSON.stringify(valid) }] };
				},
				};
			},
		},
	} as any;
	const evidence = {
		schemaVersion: 1 as const,
		capturedAt: "2026-09-15T00:00:00.000Z",
		userPrompt: "repair budget",
		assistantText: "",
		imageCount: 0,
		tools: [],
		knownPaths: [],
		projectFacts: [],
	};

	await generateHint(ctx, { api: "openai-responses" } as any, evidence, EMPTY_SESSION_STATE, EMPTY_PROJECT_STATE, new AbortController().signal);
	const firstText = requests[0].messages[0].content[0].text;
	const repairText = requests[1].messages[0].content[0].text;
	expect(firstText.length).toBeLessThanOrEqual(20_000);
	expect(repairText.length).toBeLessThanOrEqual(20_000);
	expect(JSON.parse(repairText.slice(0, repairText.indexOf("\n\nREPAIR:")))).toEqual(JSON.parse(firstText));
	const repairError = repairText.slice(repairText.indexOf("Previous output failed validation: ") + "Previous output failed validation: ".length, repairText.indexOf(". Return only one JSON object"));
	expect(repairError.length).toBeLessThanOrEqual(500);
	expect(repairError).toContain("JSON");
});

test("summary packing fails before sending when the pinned final result cannot fit", async () => {
	let requests = 0;
	const ctx = {
		modelRegistry: {
			streamSimple: () => {
				requests++;
				return { result: async () => ({ content: [] }) };
			},
		},
	} as any;
	const evidence = {
		schemaVersion: 1 as const,
		capturedAt: "2026-09-15T00:00:00.000Z",
		userPrompt: "",
		assistantText: "",
		imageCount: 0,
		tools: [{ name: "N".repeat(21_000), ok: true, input: "", result: "final result", paths: [] }],
		knownPaths: [],
		projectFacts: [],
	};

	await expect(
		generateHint(ctx, { api: "openai-responses" } as any, evidence, EMPTY_SESSION_STATE, EMPTY_PROJECT_STATE, new AbortController().signal),
	).rejects.toThrow();
	expect(requests).toBe(0);
});

test("card details show blockers and failures before older verification", () => {
	const record = pendingRecord();
	record.status = "ready";
	record.hint = emptyHint();
	record.hint.turnDelta.failures = ["FAILURE_HISTORY_PIN"];
	record.hint.turnDelta.verification = Array.from({ length: 8 }, (_, index) => `OLD_VERIFICATION_${index + 1}`);
	record.sessionState = {
		...EMPTY_SESSION_STATE,
		blockers: ["CURRENT_BLOCKER_PIN"],
		openLoops: ["OPEN_LOOP_PIN"],
	};
	record.projectState = EMPTY_PROJECT_STATE;

	const rendered = contextHintCard(() => record, () => 0, true, theme).render(100).join("\n");
	expect(rendered.indexOf("blocked: CURRENT_BLOCKER_PIN")).toBeLessThan(rendered.indexOf("failed: FAILURE_HISTORY_PIN"));
	expect(rendered.indexOf("failed: FAILURE_HISTORY_PIN")).toBeLessThan(rendered.indexOf("open: OPEN_LOOP_PIN"));
	expect(rendered.indexOf("open: OPEN_LOOP_PIN")).toBeLessThan(rendered.indexOf("verified: OLD_VERIFICATION_1"));
	expect(rendered.match(/(?:blocked:|failed:|open:|verified:|ruled out:)/g)).toHaveLength(6);
	expect(rendered).not.toContain("OLD_VERIFICATION_7");
	expect(rendered).not.toContain("BLOCKED");
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

function recoveryTestModel(overrides: Record<string, unknown> = {}) {
	return {
		provider: "openai",
		id: "summary",
		api: "openai-responses",
		baseUrl: "https://api.example.test/v1",
		reasoning: true,
		thinkingLevelMap: { off: "none", low: "low", medium: "medium", high: "high", max: "max" },
		...overrides,
	} as any;
}

function summaryEvidence() {
	return {
		schemaVersion: 1 as const,
		capturedAt: "2026-09-15T00:00:00.000Z",
		userPrompt: "recovery test",
		assistantText: "",
		imageCount: 0,
		tools: [],
		knownPaths: [],
		projectFacts: [],
	};
}

function unsupportedValueError(attempted: string, model: string, supported: string[]): string {
	const list = supported.length === 1
		? `'${supported[0]}'`
		: supported.length === 2
			? `'${supported[0]}' and '${supported[1]}'`
			: `${supported.slice(0, -1).map((value) => `'${value}'`).join(", ")}, and '${supported.at(-1)}'`;
	return JSON.stringify({
		code: "unsupported_value",
		param: "reasoning.effort",
		type: "invalid_request_error",
		message: `Unsupported value: '${attempted}' is not supported with the '${model}' model. Supported values are: ${list}.`,
	});
}

function providerError(errorMessage: string) {
	return { stopReason: "error", errorMessage, content: [] };
}

function completedSummary(hint: unknown) {
	return { stopReason: "toolUse", content: [{ type: "text", text: JSON.stringify(hint) }] };
}

function mockSummaryContext(
	responses: any[],
	requests: Array<{ request: any; options: any }>,
	onRequest?: () => void,
) {
	let index = 0;
	return {
		ui: { notify() {} },
		modelRegistry: {
			streamSimple: (_model: unknown, request: any, options: any) => {
				requests.push({ request, options });
				onRequest?.();
				const response = responses[Math.min(index++, responses.length - 1)];
				return { result: async () => response };
			},
		},
	} as any;
}

function recoveryHooks(overrides: Record<string, unknown> = {}) {
	return {
		isCurrent: () => true,
		getAcceptedLevel: () => undefined,
		warn() {},
		accepted() {},
		invalidate() {},
		...overrides,
	} as any;
}

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

function parseSummaryRequest(request: any) {
	const text = request.messages[0].content[0].text as string;
	const repairIndex = text.indexOf("\n\nREPAIR:");
	return {
		text,
		payload: JSON.parse(repairIndex < 0 ? text : text.slice(0, repairIndex)),
	};
}

async function createToolEvidenceHarness(options: { model?: any; responses?: any[] } = {}) {
	const temp = await mkdtemp(join(tmpdir(), "context-hint-evidence-"));
	const agentDir = join(temp, "agent");
	const projectRoot = join(temp, "project");
	const cwdPath = join(projectRoot, "nested");
	await mkdir(cwdPath, { recursive: true });
	const cwd = await realpath(cwdPath);
	await writeFile(join(projectRoot, "README.md"), "tool evidence test project");
	const sourceRoot = await realpath(projectRoot);
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	await writeConfig(projectPaths(agentDir, `dir:${sourceRoot}`), { ...DEFAULT_CONFIG, enabled: true });

	const listeners = new Map<string, (event: any, ctx: any) => any>();
	const requests: any[] = [];
	const requestOptions: any[] = [];
	const entries: any[] = [];
	const notifications: Array<{ message: string; level: string }> = [];
	const commands = new Map<string, any>();
	const events: string[] = [];
	const responses = options.responses ?? [];
	let sessionId = "evidence-session";
	const model = options.model ?? {
		provider: "openai",
		id: "summary",
		api: "openai-responses",
		baseUrl: "https://api.example.test/v1",
		reasoning: true,
		thinkingLevelMap: { off: "none", low: "low", medium: "medium", high: "high" },
	};
	const ctx = {
		hasUI: true,
		mode: "tui",
		cwd,
		model,
		scopedModels: [],
		modelRegistry: {
			getAvailable: () => [model],
			streamSimple: (_model: unknown, request: any, requestOptionsValue: any) => {
				requests.push(request);
				events.push(`request:${requests.length}`);
				requestOptions.push(requestOptionsValue);
				const response = responses.shift();
				return { result: async () => typeof response === "function" ? response(request, requestOptionsValue) : response ?? completedSummary(emptyHint()) };
			},
		},
		sessionManager: {
			getSessionId: () => sessionId,
			getEntries: () => entries,
			getBranch: () => entries,
		},
		ui: {
			theme,
			notify: (message: string, level: string) => {
				notifications.push({ message, level });
				events.push("warning");
			},
			setStatus() {},
			setWidget() {},
		},
		isIdle: () => true,
		isProjectTrusted: () => true,
	};
	const pi = {
		on: (name: string, listener: (event: any, ctx: any) => any) => listeners.set(name, listener),
		registerCommand: (name: string, command: any) => commands.set(name, command),
		registerShortcut() {},
		registerEntryRenderer() {},
		appendEntry: (type: string, data: unknown) => entries.push({ type: "custom", customType: type, data }),
		exec: async () => ({ code: 1, stdout: "", stderr: "" }),
	};
	registerContextHint(pi as any);
	await listeners.get("session_start")!({ reason: "resume" }, ctx);

	return {
		ctx,
		listeners,
		requests,
		requestOptions,
		notifications,
		events,
		entries,
		command: (args: string) => commands.get("context-hint").handler(args, ctx),
		beforeAgentStart(prompt: string) {
			listeners.get("before_agent_start")!({ prompt, images: [] }, ctx);
		},
		startTool(toolCallId: string, toolName: string, args: unknown) {
			listeners.get("tool_execution_start")!({ toolCallId, toolName, args }, ctx);
		},
		endTool(toolCallId: string, toolName: string, result: string, isError: boolean) {
			listeners.get("tool_execution_end")!({
				toolCallId,
				toolName,
				result: { content: [{ type: "text", text: result }] },
				isError,
			}, ctx);
		},
		beginSettlement() {
			return listeners.get("agent_settled")!({ aborted: false }, ctx);
		},
		async settle() {
			const requestIndex = requests.length;
			await listeners.get("agent_settled")!({ aborted: false }, ctx);
			await this.waitForRequestCount(requestIndex + 1);
			return requests[requestIndex];
		},
		async waitForRequestCount(count: number) {
			for (let attempt = 0; attempt < 100; attempt++) {
				if (requests.length >= count) return;
				await new Promise((resolve) => setTimeout(resolve, 1));
			}
			throw new Error(`summary request ${count} did not arrive`);
		},
		async waitForLatestRecord() {
			const entry = entries.at(-1);
			const generationId = entry?.data?.generationId;
			if (!generationId) throw new Error("summary generation was not scheduled");
			const paths = projectPaths(agentDir, `dir:${sourceRoot}`);
			for (let attempt = 0; attempt < 100; attempt++) {
				const record = await readGeneration(paths, generationId);
				if (record && record.status !== "pending") return record;
				await new Promise((resolve) => setTimeout(resolve, 1));
			}
			throw new Error("summary generation did not finish");
		},
		async startSession(nextSessionId: string) {
			sessionId = nextSessionId;
			await listeners.get("session_start")!({ reason: "new" }, ctx);
		},
		async close() {
			await listeners.get("session_shutdown")!({ reason: "quit" }, ctx);
			if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
			await rm(temp, { recursive: true, force: true });
		},
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
