import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

export const ENTRY_TYPE = "context-hint-v1";
export const SCHEMA_VERSION = 1;
export const MODEL_THINKING_LEVEL_ORDER: readonly ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export type SessionStatus =
	| "exploring"
	| "implementing"
	| "verifying"
	| "blocked"
	| "decision-needed"
	| "done";

export interface CodeCue {
	path: string;
	reason: string;
	kind: "modified" | "created" | "deleted" | "verified" | "focal";
}

export interface LegacyCodeCue {
	path: string;
	lineStart?: number;
	lineEnd?: number;
	reason?: string;
	kind?: "read" | CodeCue["kind"];
}

export interface TurnDelta {
	accomplished: string[];
	learned: string[];
	ruledOut: string[];
	codeCues: CodeCue[];
	filesTouched?: LegacyCodeCue[];
	verification: string[];
	failures: string[];
	decisionsMade: string[];
	questionsForHuman: string[];
	nextSuggestedAction?: string;
}

export interface SessionState {
	goal: string;
	currentFocus: string;
	currentHypothesis: string;
	status: SessionStatus;
	openLoops: string[];
	ruledOut: string[];
	blockers: string[];
	nextSteps: string[];
}

export type SessionPatch = Partial<SessionState>;

export interface ImportantDecision {
	decision: string;
	rationale?: string;
}

export interface ProjectState {
	summary: string;
	purpose: string;
	architecture: string[];
	constraints: string[];
	conventions: string[];
	importantDecisions: ImportantDecision[];
	currentPhase: string;
}

export type ProjectPatch = Partial<ProjectState>;

export interface ContextHintV1 {
	turnDelta: TurnDelta;
	sessionPatch: SessionPatch;
	projectPatch: ProjectPatch | null;
	attentionCue: {
		level: "none" | "info" | "decision-needed" | "blocked" | "risk";
		message?: string;
	};
}

export interface ToolFact {
	name: string;
	ok: boolean;
	input: string;
	result: string;
	paths: string[];
}

export interface TurnEvidence {
	schemaVersion: 1;
	capturedAt: string;
	userPrompt: string;
	assistantText: string;
	imageCount: number;
	tools: ToolFact[];
	knownPaths: string[];
	projectFacts: Array<{ path: string; excerpt: string }>;
}

export interface GenerationRecord {
	schemaVersion: 1;
	generationId: string;
	sessionId: string;
	status: "pending" | "ready" | "error";
	createdAt: string;
	updatedAt: string;
	projectEpoch: number;
	baseSessionState: SessionState;
	sessionState?: SessionState;
	projectState?: ProjectState;
	hint?: ContextHintV1;
	evidence?: TurnEvidence;
	error?: string;
}

export interface ContextHintConfig {
	schemaVersion: 1;
	enabled: boolean;
	model: { mode: "inherit" } | { mode: "explicit"; provider: string; id: string };
	thinkingLevels?: Record<string, ModelThinkingLevel>;
	lastSessionModel?: { provider: string; id: string };
}

export type ContextHintMotion = "animate" | "reduce";

export interface ContextHintSettings {
	schemaVersion: 1;
	expanded: boolean;
	motion: ContextHintMotion;
}

export interface ProjectDocument {
	schemaVersion: 1;
	identity: string;
	sourceRoot: string;
	epoch: number;
	revision: number;
	updatedAt: string;
	state: ProjectState;
}

export interface ProjectPaths {
	dir: string;
	config: string;
	project: string;
	generations: string;
	lock: string;
}

export const EMPTY_SESSION_STATE: SessionState = {
	goal: "",
	currentFocus: "",
	currentHypothesis: "",
	status: "exploring",
	openLoops: [],
	ruledOut: [],
	blockers: [],
	nextSteps: [],
};

export const EMPTY_PROJECT_STATE: ProjectState = {
	summary: "",
	purpose: "",
	architecture: [],
	constraints: [],
	conventions: [],
	importantDecisions: [],
	currentPhase: "",
};

export const DEFAULT_CONFIG: ContextHintConfig = {
	schemaVersion: 1,
	enabled: false,
	model: { mode: "inherit" },
};

export const DEFAULT_CONTEXT_HINT_SETTINGS: ContextHintSettings = {
	schemaVersion: 1,
	expanded: true,
	motion: "animate",
};

const SECRET_PATTERNS: Array<[RegExp, string]> = [
	[/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[REDACTED PRIVATE KEY]"],
	[/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]"],
	[/\b(sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]"],
	[/\b(api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret)\b(\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[REDACTED]"],
];

export function redactAndTruncate(value: unknown, maxChars: number): string {
	let text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
	for (const [pattern, replacement] of SECRET_PATTERNS) text = text.replace(pattern, replacement);
	if (text.length <= maxChars) return text;
	return `${text.slice(0, Math.max(0, maxChars - 20))}\n… [truncated]`;
}

export function mergeSessionState(state: SessionState, patch: SessionPatch): SessionState {
	return {
		goal: patch.goal ?? state.goal,
		currentFocus: patch.currentFocus ?? state.currentFocus,
		currentHypothesis: patch.currentHypothesis ?? state.currentHypothesis,
		status: patch.status ?? state.status,
		openLoops: patch.openLoops ?? state.openLoops,
		ruledOut: patch.ruledOut ?? state.ruledOut,
		blockers: patch.blockers ?? state.blockers,
		nextSteps: patch.nextSteps ?? state.nextSteps,
	};
}

export function mergeProjectState(state: ProjectState, patch: ProjectPatch): ProjectState {
	return {
		summary: patch.summary ?? state.summary,
		purpose: patch.purpose ?? state.purpose,
		architecture: mergeStrings(state.architecture, patch.architecture),
		constraints: mergeStrings(state.constraints, patch.constraints),
		conventions: mergeStrings(state.conventions, patch.conventions),
		importantDecisions: mergeDecisions(state.importantDecisions, patch.importantDecisions),
		currentPhase: patch.currentPhase ?? state.currentPhase,
	};
}

function mergeStrings(current: string[], patch?: string[]): string[] {
	if (patch === undefined) return current;
	if (patch.length === 0) return [];
	return [...new Set([...current, ...patch].map((item) => item.trim()).filter(Boolean))];
}

function mergeDecisions(current: ImportantDecision[], patch?: ImportantDecision[]): ImportantDecision[] {
	if (patch === undefined) return current;
	if (patch.length === 0) return [];
	const merged = new Map(current.map((item) => [item.decision.trim(), item]));
	for (const item of patch) {
		const decision = item.decision.trim();
		if (!decision) continue;
		merged.set(decision, { decision, ...(item.rationale?.trim() ? { rationale: item.rationale.trim() } : {}) });
	}
	return [...merged.values()];
}

export function codeCuePaths(tools: ToolFact[]): string[] {
	return [...new Set(tools.filter((tool) => tool.ok).flatMap((tool) => tool.paths))].sort();
}

export function normalizeCodeCueEvidence(evidence: TurnEvidence): TurnEvidence {
	return { ...evidence, knownPaths: codeCuePaths(evidence.tools) };
}

export function validateCodeCues(cues: CodeCue[], knownPaths: Set<string>): void {
	for (const cue of cues) {
		if (!knownPaths.has(cue.path)) throw new Error(`unsupported code cue: ${cue.path}`);
		if (!cue.reason.trim()) throw new Error(`unsupported code cue reason: ${cue.path}`);
	}
}

export function collectGenerationIds(entries: Array<{ type?: string; customType?: string; data?: unknown }>): string[] {
	const ids: string[] = [];
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE || !isObject(entry.data)) continue;
		if (entry.data.kind === "hint" && typeof entry.data.generationId === "string") ids.push(entry.data.generationId);
	}
	return ids;
}

export function restoreSessionState(
	entries: Array<{ type?: string; customType?: string; data?: unknown }>,
	records: ReadonlyMap<string, GenerationRecord>,
): SessionState {
	let state = EMPTY_SESSION_STATE;
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE || !isObject(entry.data)) continue;
		if (entry.data.kind === "session-reset") {
			state = EMPTY_SESSION_STATE;
			continue;
		}
		if (entry.data.kind !== "hint" || typeof entry.data.generationId !== "string") continue;
		const record = records.get(entry.data.generationId);
		if (record?.status === "ready" && record.sessionState) state = record.sessionState;
	}
	return cloneSessionState(state);
}

export function latestGenerationRecord(
	entries: Array<{ type?: string; customType?: string; data?: unknown }>,
	records: ReadonlyMap<string, GenerationRecord>,
): GenerationRecord | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE || !isObject(entry.data)) continue;
		if (entry.data.kind === "session-reset") return undefined;
		if (entry.data.kind === "hint" && typeof entry.data.generationId === "string") {
			return records.get(entry.data.generationId);
		}
	}
	return undefined;
}

export function projectPaths(agentDir: string, identity: string): ProjectPaths {
	const key = createHash("sha256").update(identity).digest("hex").slice(0, 24);
	const dir = join(agentDir, "context-hint", "projects", key);
	return {
		dir,
		config: join(dir, "config.json"),
		project: join(dir, "project.json"),
		generations: join(dir, "generations"),
		lock: join(dir, ".project.lock"),
	};
}

export function contextHintSettingsPath(agentDir: string): string {
	return join(agentDir, "context-hint", "settings.json");
}

export async function readContextHintSettings(agentDir: string): Promise<ContextHintSettings> {
	return (await readValidatedJson(contextHintSettingsPath(agentDir), isContextHintSettings)) ?? { ...DEFAULT_CONTEXT_HINT_SETTINGS };
}

export async function writeContextHintSettings(agentDir: string, settings: ContextHintSettings): Promise<void> {
	await atomicWriteJson(contextHintSettingsPath(agentDir), settings);
}

export function generationPath(paths: ProjectPaths, generationId: string): string {
	if (!/^[a-zA-Z0-9-]+$/.test(generationId)) throw new Error("Invalid generation id");
	return join(paths.generations, `${generationId}.json`);
}

export async function readConfig(paths: ProjectPaths): Promise<ContextHintConfig> {
	return (await readValidatedJson(paths.config, isConfig)) ?? cloneConfig(DEFAULT_CONFIG);
}

export async function writeConfig(paths: ProjectPaths, config: ContextHintConfig): Promise<void> {
	await atomicWriteJson(paths.config, config);
}

export async function readProjectDocument(
	paths: ProjectPaths,
	identity: string,
	sourceRoot: string,
): Promise<ProjectDocument> {
	return (
		(await readValidatedJson(paths.project, isProjectDocument)) ?? {
			schemaVersion: 1,
			identity,
			sourceRoot,
			epoch: 0,
			revision: 0,
			updatedAt: new Date(0).toISOString(),
			state: cloneProjectState(EMPTY_PROJECT_STATE),
		}
	);
}

export async function updateProjectDocument(
	paths: ProjectPaths,
	identity: string,
	sourceRoot: string,
	expectedEpoch: number,
	patch: ProjectPatch | null,
): Promise<ProjectDocument> {
	return withProjectLock(paths, async () => {
		const current = await readProjectDocument(paths, identity, sourceRoot);
		if (!patch || current.epoch !== expectedEpoch) return current;
		const next: ProjectDocument = {
			...current,
			revision: current.revision + 1,
			updatedAt: new Date().toISOString(),
			state: mergeProjectState(current.state, patch),
		};
		await atomicWriteJson(paths.project, next);
		return next;
	});
}

export async function resetProjectDocument(
	paths: ProjectPaths,
	identity: string,
	sourceRoot: string,
): Promise<ProjectDocument> {
	return withProjectLock(paths, async () => {
		const current = await readProjectDocument(paths, identity, sourceRoot);
		const next: ProjectDocument = {
			...current,
			epoch: current.epoch + 1,
			revision: current.revision + 1,
			updatedAt: new Date().toISOString(),
			state: cloneProjectState(EMPTY_PROJECT_STATE),
		};
		await atomicWriteJson(paths.project, next);
		return next;
	});
}

export async function readGeneration(paths: ProjectPaths, generationId: string): Promise<GenerationRecord | undefined> {
	return readValidatedJson(generationPath(paths, generationId), isGenerationRecord);
}

export async function writeGeneration(paths: ProjectPaths, record: GenerationRecord): Promise<void> {
	await atomicWriteJson(generationPath(paths, record.generationId), record);
}

export function cloneSessionState(state: SessionState): SessionState {
	return {
		...state,
		openLoops: [...state.openLoops],
		ruledOut: [...state.ruledOut],
		blockers: [...state.blockers],
		nextSteps: [...state.nextSteps],
	};
}

export function cloneProjectState(state: ProjectState): ProjectState {
	return {
		...state,
		architecture: [...state.architecture],
		constraints: [...state.constraints],
		conventions: [...state.conventions],
		importantDecisions: state.importantDecisions.map((item) => ({ ...item })),
	};
}

function cloneConfig(config: ContextHintConfig): ContextHintConfig {
	return {
		...config,
		model: config.model.mode === "inherit" ? { mode: "inherit" } : { ...config.model },
		...(config.lastSessionModel ? { lastSessionModel: { ...config.lastSessionModel } } : {}),
	};
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	const handle = await open(temporary, "wx", 0o600);
	try {
		await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	await rename(temporary, path);
}

async function readValidatedJson<T>(path: string, validate: (value: unknown) => value is T): Promise<T | undefined> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	try {
		const value = JSON.parse(text) as unknown;
		if (!validate(value)) throw new Error("invalid shape");
		return value;
	} catch {
		await rename(path, `${path}.corrupt-${Date.now()}`).catch(() => undefined);
		return undefined;
	}
}

async function withProjectLock<T>(paths: ProjectPaths, work: () => Promise<T>): Promise<T> {
	await mkdir(paths.dir, { recursive: true });
	const deadline = Date.now() + 2_000;
	while (true) {
		try {
			await mkdir(paths.lock);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const lockStat = await stat(paths.lock).catch(() => undefined);
			if (lockStat && Date.now() - lockStat.mtimeMs > 30_000) {
				await rm(paths.lock, { recursive: true, force: true });
				continue;
			}
			if (Date.now() >= deadline) throw new Error("Context Hint project state is busy");
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	}
	try {
		return await work();
	} finally {
		await rm(paths.lock, { recursive: true, force: true });
	}
}

function isContextHintSettings(value: unknown): value is ContextHintSettings {
	return isObject(value) && value.schemaVersion === 1 && typeof value.expanded === "boolean" && (value.motion === "animate" || value.motion === "reduce");
}

function isConfig(value: unknown): value is ContextHintConfig {
	return (
		isObject(value) &&
		value.schemaVersion === 1 &&
		typeof value.enabled === "boolean" &&
		isObject(value.model) &&
		(value.model.mode === "inherit" ||
			(value.model.mode === "explicit" && typeof value.model.provider === "string" && typeof value.model.id === "string")) &&
		(value.thinkingLevels === undefined ||
			(isObject(value.thinkingLevels) && Object.values(value.thinkingLevels).every((level) => MODEL_THINKING_LEVEL_ORDER.includes(level)))) &&
		(value.lastSessionModel === undefined ||
			(isObject(value.lastSessionModel) &&
				typeof value.lastSessionModel.provider === "string" &&
				typeof value.lastSessionModel.id === "string"))
	);
}

function isProjectDocument(value: unknown): value is ProjectDocument {
	return (
		isObject(value) &&
		value.schemaVersion === 1 &&
		typeof value.identity === "string" &&
		typeof value.sourceRoot === "string" &&
		Number.isInteger(value.epoch) &&
		Number.isInteger(value.revision) &&
		typeof value.updatedAt === "string" &&
		isProjectState(value.state)
	);
}

function isProjectState(value: unknown): value is ProjectState {
	return (
		isObject(value) &&
		typeof value.summary === "string" &&
		typeof value.purpose === "string" &&
		isStringArray(value.architecture) &&
		isStringArray(value.constraints) &&
		isStringArray(value.conventions) &&
		Array.isArray(value.importantDecisions) &&
		value.importantDecisions.every(
			(item) => isObject(item) && typeof item.decision === "string" && (item.rationale === undefined || typeof item.rationale === "string"),
		) &&
		typeof value.currentPhase === "string"
	);
}

function isGenerationRecord(value: unknown): value is GenerationRecord {
	return (
		isObject(value) &&
		value.schemaVersion === 1 &&
		typeof value.generationId === "string" &&
		typeof value.sessionId === "string" &&
		(value.status === "pending" || value.status === "ready" || value.status === "error") &&
		typeof value.createdAt === "string" &&
		typeof value.updatedAt === "string" &&
		Number.isInteger(value.projectEpoch) &&
		isSessionState(value.baseSessionState)
	);
}

function isSessionState(value: unknown): value is SessionState {
	return (
		isObject(value) &&
		typeof value.goal === "string" &&
		typeof value.currentFocus === "string" &&
		typeof value.currentHypothesis === "string" &&
		["exploring", "implementing", "verifying", "blocked", "decision-needed", "done"].includes(String(value.status)) &&
		isStringArray(value.openLoops) &&
		isStringArray(value.ruledOut) &&
		isStringArray(value.blockers) &&
		isStringArray(value.nextSteps)
	);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isObject(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
