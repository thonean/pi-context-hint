import { expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DefaultPackageManager, DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { EXPECTED_TARBALL_ENTRIES, validatePackageMetadata, validateTarballEntries } from "../scripts/package-check";

const manifest = {
	name: "@your-scope/pi-context-hint",
	version: "0.0.0-development",
	private: true,
	author: "YOUR_NAME",
	license: "MIT",
	repository: { type: "git", url: "git+https://github.com/your-org/pi-context-hint.git" },
	homepage: "https://github.com/your-org/pi-context-hint#readme",
	bugs: { url: "https://github.com/your-org/pi-context-hint/issues" },
	files: ["extensions/context-hint.ts", "src/core.ts", "README.md", "LICENSE", "assets/context-hint-logo.svg", "assets/context-hint-still.png"],
	pi: { extensions: ["extensions/context-hint.ts"] },
};

test("release metadata guard blocks placeholders while normal package metadata remains valid", () => {
	expect(validatePackageMetadata(manifest)).toEqual([]);
	expect(validatePackageMetadata(manifest, true)).toEqual([
		"package.json is private; replace private: true before publishing",
		"package name still uses placeholder scope/name",
		"repository URL is missing or still a placeholder",
		"homepage URL is missing or still a placeholder",
		"bugs URL is missing or still a placeholder",
		"author is missing or still a placeholder",
		"version is missing or still a placeholder",
	]);
});

test("tarball allowlist rejects both omitted and unexpected entries", () => {
	expect(validateTarballEntries(EXPECTED_TARBALL_ENTRIES)).toEqual([]);
	expect(validateTarballEntries(["package/package.json", "package/extensions/context-hint.ts", "package/debug.log"])).toEqual([
		"tarball is missing package/LICENSE",
		"tarball is missing package/README.md",
		"tarball is missing package/assets/context-hint-logo.svg",
		"tarball is missing package/assets/context-hint-still.png",
		"tarball is missing package/src/core.ts",
		"tarball contains unexpected package/debug.log",
	]);
});

test("package metadata rejects repository-only demo GIF", () => {
	expect(validatePackageMetadata({
		...manifest,
		files: [...manifest.files, "assets/context-hint-demo.gif"],
	})).toEqual([
		"package.json files must list the extension source, core source, README, license, logo, and static preview",
	]);
});

test("source-only package discovery loads and registers Context Hint without dist or node_modules", async () => {
	const workspace = await mkdtemp(join(tmpdir(), "pi-context-hint-loader-"));
	const packageRoot = join(workspace, "package");
	const sourceRoot = resolve(import.meta.dir, "..");

	try {
		await mkdir(join(packageRoot, "extensions"), { recursive: true });
		await mkdir(join(packageRoot, "src"), { recursive: true });
		await Promise.all([
			copyFile(join(sourceRoot, "package.json"), join(packageRoot, "package.json")),
			copyFile(join(sourceRoot, "extensions/context-hint.ts"), join(packageRoot, "extensions/context-hint.ts")),
			copyFile(join(sourceRoot, "src/core.ts"), join(packageRoot, "src/core.ts")),
		]);
		await writeFile(join(workspace, "package.json"), '{"private":true}\n');
		const settingsManager = SettingsManager.create(workspace, join(workspace, "agent"));
		const packageManager = new DefaultPackageManager({
			cwd: workspace,
			agentDir: join(workspace, "agent"),
			settingsManager,
		});
		const resolved = await packageManager.resolveExtensionSources([packageRoot], { temporary: true });
		expect(resolved.extensions).toHaveLength(1);
		expect(resolved.extensions[0]?.path).toBe(join(packageRoot, "extensions/context-hint.ts"));

		const loader = new DefaultResourceLoader({
			cwd: workspace,
			agentDir: join(workspace, "agent"),
			additionalExtensionPaths: [packageRoot],
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await loader.reload();
		const loaded = loader.getExtensions();
		expect(loaded.errors).toEqual([]);
		expect(loaded.extensions).toHaveLength(1);
		expect([...loaded.extensions[0]!.commands.keys()]).toContain("context-hint");
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
});

test("tarball rejects repository-only demo GIF and MP4", () => {
	expect(validateTarballEntries([
		...EXPECTED_TARBALL_ENTRIES,
		"package/assets/context-hint-demo.gif",
		"package/assets/context-hint-demo.mp4",
	])).toEqual([
		"tarball contains unexpected package/assets/context-hint-demo.gif",
		"tarball contains unexpected package/assets/context-hint-demo.mp4",
	]);
});
