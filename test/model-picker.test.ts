import { expect, test } from "bun:test";
import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { chooseModel, modelThinkingKey, resolveThinkingLevel } from "../extensions/context-hint";
import { DEFAULT_CONFIG } from "../src/core";

const keys = { up: "\x1b[A", down: "\x1b[B", left: "\x1b[D", right: "\x1b[C", enter: "\r", escape: "\x1b" };
const theme = { bold: (text: string) => text, fg: (_color: string, text: string) => text } as any;

test("uses Pi model capabilities and independent per-provider model memory", async () => {
	const inherited = model("openai", "shared", { xhigh: "xhigh" });
	const otherProvider = model("anthropic", "shared");
	const config = {
		...DEFAULT_CONFIG,
		thinkingLevels: { [modelThinkingKey(inherited)]: "xhigh" as const, [modelThinkingKey(otherProvider)]: "medium" as const },
	};
	const picker = openPicker(inherited, [inherited, otherProvider], config, "high");

	expect(picker.render()).toContain("Thinking level: xhigh");
	picker.input(keys.down);
	expect(picker.render()).toContain("Thinking level: xhigh");
	picker.input(keys.down);
	expect(picker.render()).toContain("Thinking level: medium");
	picker.input(keys.enter);

	const saved = await picker.result;
	expect(saved?.model).toEqual({ mode: "explicit", provider: "anthropic", id: "shared" });
	expect(saved?.thinkingLevels).toEqual(config.thinkingLevels);
	expect(picker.context.thinkingLevel).toBe("high");
});

test("keeps multiple model drafts, but Enter commits only selected model and level", async () => {
	const a = model("openai", "a");
	const b = model("openai", "b");
	const config = { ...DEFAULT_CONFIG, thinkingLevels: { [modelThinkingKey(a)]: "low" as const, [modelThinkingKey(b)]: "high" as const } };
	const picker = openPicker(a, [a, b], config);

	picker.input(keys.right);
	expect(picker.render()).toContain("Thinking level: medium");
	picker.input(keys.down);
	expect(picker.render()).toContain("Thinking level: medium");
	picker.input(keys.right);
	picker.input(keys.down);
	expect(picker.render()).toContain("Thinking level: high");
	picker.input(keys.left);
	picker.input(keys.enter);

	expect(await picker.result).toMatchObject({
		model: { mode: "explicit", provider: "openai", id: "b" },
		thinkingLevels: { "openai/a": "low", "openai/b": "medium" },
	});
});

test("cancel discards all model and thinking drafts", async () => {
	const a = model("openai", "a");
	const b = model("openai", "b");
	const config = { ...DEFAULT_CONFIG, thinkingLevels: { [modelThinkingKey(a)]: "low" as const, [modelThinkingKey(b)]: "high" as const } };
	const before = structuredClone(config);
	const picker = openPicker(a, [a, b], config);

	picker.input(keys.right);
	picker.input(keys.down);
	picker.input(keys.down);
	picker.input(keys.left);
	picker.input(keys.escape);

	expect(await picker.result).toBeUndefined();
	expect(config).toEqual(before);
});

test("restores a different inherited model's remembered thinking level, independent of Pi's level", () => {
	const first = model("openai", "first");
	const second = model("anthropic", "second", { xhigh: "xhigh" });
	const config = {
		...DEFAULT_CONFIG,
		thinkingLevels: { [modelThinkingKey(first)]: "low" as const, [modelThinkingKey(second)]: "xhigh" as const },
	};
	expect(openPicker(first, [first, second], config, "high").render()).toContain("Thinking level: low");
	expect(openPicker(second, [first, second], config, "off").render()).toContain("Thinking level: xhigh");
});

test("shows stale-level fallback without writing until Enter", async () => {
	const limited = model("openai", "limited");
	const config = { ...DEFAULT_CONFIG, thinkingLevels: { [modelThinkingKey(limited)]: "xhigh" as const } };
	const picker = openPicker(limited, [limited], config);

	expect(resolveThinkingLevel(limited, "xhigh")).toEqual({ level: "high", fallbackFrom: "xhigh" });
	expect(picker.render()).toContain("Saved level xhigh is unsupported; showing high. Enter saves fallback.");
	expect(config.thinkingLevels?.[modelThinkingKey(limited)]).toBe("xhigh");
	picker.input(keys.enter);
	expect((await picker.result)?.thinkingLevels?.[modelThinkingKey(limited)]).toBe("high");
});

test("bounds thinking controls and disables them for unsupported models", async () => {
	const limited = model("openai", "limited");
	const lowOnly = model("openai", "low-only", { off: null });
	const unsupported = model("local", "plain", {}, false);

	expect(resolveThinkingLevel(limited).level).toBe("off");
	expect(resolveThinkingLevel(limited, "high").level).toBe("high");
	const bounded = openPicker(limited, [limited], { ...DEFAULT_CONFIG, thinkingLevels: { [modelThinkingKey(limited)]: "high" } });
	bounded.input(keys.up);
	expect(bounded.render()).toContain("Thinking level: high");
	bounded.input(keys.right);
	expect(bounded.render()).toContain("Thinking level: high");
	bounded.input(keys.left);
	expect(bounded.render()).toContain("Thinking level: medium");
	for (let i = 0; i < 3; i++) bounded.input(keys.left);
	expect(bounded.render()).toContain("Thinking level: off");
	bounded.input(keys.left);
	expect(bounded.render()).toContain("Thinking level: off");
	bounded.input(keys.down);
	expect(bounded.render()).toContain("Thinking level: off");
	bounded.input(keys.down);
	expect(bounded.render()).toContain("Thinking level: off");
	bounded.input(keys.escape);
	await bounded.result;

	expect(resolveThinkingLevel(lowOnly).level).toBe("minimal");
	expect(resolveThinkingLevel(lowOnly, "off")).toEqual({ level: "minimal", fallbackFrom: "off" });
	const noThinking = openPicker(unsupported, [unsupported], {
		...DEFAULT_CONFIG,
		thinkingLevels: { [modelThinkingKey(unsupported)]: "high" },
	});
	const before = noThinking.render();
	expect(before).toContain("Thinking not supported");
	expect(before).not.toContain("Supported:");
	noThinking.input(keys.left);
	noThinking.input(keys.right);
	expect(noThinking.render()).toEqual(before);
	noThinking.input(keys.enter);
	expect((await noThinking.result)?.thinkingLevels?.[modelThinkingKey(unsupported)]).toBe("off");
});

function model(
	provider: string,
	id: string,
	thinkingLevelMap: Partial<Record<ModelThinkingLevel, string | null>> = {},
	reasoning = true,
): Model<Api> {
	return { provider, id, api: "openai-responses", reasoning, thinkingLevelMap } as Model<Api>;
}

function openPicker(
	mainModel: Model<Api>,
	models: Model<Api>[],
	config: typeof DEFAULT_CONFIG | (typeof DEFAULT_CONFIG & { thinkingLevels: Record<string, ModelThinkingLevel> }),
	mainThinkingLevel: string = "high",
) {
	let component: { render(width: number): string[]; handleInput(data: string): void } | undefined;
	let renderRequests = 0;
	const context = {
		mode: "tui",
		hasUI: true,
		model: mainModel,
		thinkingLevel: mainThinkingLevel,
		scopedModels: models.map((model) => ({ model })),
		modelRegistry: { getAvailable: () => models },
		ui: {
			notify() {},
			custom(factory: (tui: any, theme: any, keybindings: any, done: (result: any) => void) => any) {
				return new Promise((resolve) => {
					component = factory({ requestRender: () => renderRequests++ }, theme, {}, resolve);
				});
			},
		},
	};
	const result = chooseModel(context as any, config);
	return {
		context,
		get renderRequests() {
			return renderRequests;
		},
		render: () => component!.render(100).join("\n"),
		input: (data: string) => component!.handleInput(data),
		result,
	};
}
