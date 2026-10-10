import { expect, test } from "bun:test";
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
	files: ["dist/context-hint.js", "README.md", "LICENSE", "assets/context-hint-logo.svg", "assets/context-hint-still.png", "assets/context-hint-demo.gif"],
	pi: { extensions: ["dist/context-hint.js"] },
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
	expect(validateTarballEntries(["package/package.json", "package/dist/context-hint.js", "package/debug.log"])).toEqual([
		"tarball is missing package/LICENSE",
		"tarball is missing package/README.md",
		"tarball is missing package/assets/context-hint-logo.svg",
		"tarball is missing package/assets/context-hint-still.png",
		"tarball is missing package/assets/context-hint-demo.gif",
		"tarball contains unexpected package/debug.log",
	]);
});

test("tarball rejects repository-only demo MP4", () => {
	expect(validateTarballEntries([
		...EXPECTED_TARBALL_ENTRIES,
		"package/assets/context-hint-demo.mp4",
	])).toEqual([
		"tarball contains unexpected package/assets/context-hint-demo.mp4",
	]);
});
