import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

export const EXPECTED_TARBALL_ENTRIES = [
	"package/LICENSE",
	"package/README.md",
	"package/assets/context-hint-logo.svg",
	"package/assets/context-hint-still.png",
	"package/extensions/context-hint.ts",
	"package/package.json",
	"package/src/core.ts",
];

interface PackageManifest {
	name?: string;
	version?: string;
	private?: boolean;
	author?: string | { name?: string };
	license?: string;
	repository?: string | { url?: string };
	homepage?: string;
	bugs?: string | { url?: string };
	files?: string[];
	pi?: { extensions?: string[] };
}

export function validatePackageMetadata(manifest: PackageManifest, release = false): string[] {
	const errors: string[] = [];
	if (manifest.files?.slice().sort().join("\n") !== ["LICENSE", "README.md", "assets/context-hint-logo.svg", "assets/context-hint-still.png", "extensions/context-hint.ts", "src/core.ts"].join("\n")) {
		errors.push('package.json files must list the extension source, core source, README, license, logo, and static preview');
	}
	if (manifest.pi?.extensions?.length !== 1 || manifest.pi.extensions[0] !== "extensions/context-hint.ts") {
		errors.push('package.json pi.extensions must point to "extensions/context-hint.ts"');
	}
	if (!release) return errors;

	if (manifest.private === true) errors.push("package.json is private; replace private: true before publishing");
	if (manifest.name === "@your-scope/pi-context-hint" || manifest.name?.includes("your-scope")) {
		errors.push("package name still uses placeholder scope/name");
	}
	const repositoryUrl = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
	if (!repositoryUrl || /your-org|example\.com/i.test(repositoryUrl)) {
		errors.push("repository URL is missing or still a placeholder");
	}
	if (!manifest.homepage || /your-org|example\.com/i.test(manifest.homepage)) {
		errors.push("homepage URL is missing or still a placeholder");
	}
	const bugsUrl = typeof manifest.bugs === "string" ? manifest.bugs : manifest.bugs?.url;
	if (!bugsUrl || /your-org|example\.com/i.test(bugsUrl)) {
		errors.push("bugs URL is missing or still a placeholder");
	}
	const author = typeof manifest.author === "string" ? manifest.author : manifest.author?.name;
	if (!author || /YOUR_NAME|placeholder/i.test(author)) errors.push("author is missing or still a placeholder");
	if (!manifest.version || manifest.version === "0.0.0-development" || /placeholder/i.test(manifest.version)) {
		errors.push("version is missing or still a placeholder");
	}
	if (!manifest.license || /placeholder/i.test(manifest.license)) {
		errors.push("license is missing or still a placeholder");
	}
	return errors;
}

export function validateTarballEntries(entries: string[]): string[] {
	const expected = new Set(EXPECTED_TARBALL_ENTRIES);
	const actual = new Set(entries.map((entry) => entry.replace(/^\.\//, "").replace(/\/$/, "")));
	const missing = EXPECTED_TARBALL_ENTRIES.filter((entry) => !actual.has(entry));
	const extra = [...actual].filter((entry) => !expected.has(entry));
	return [
		...missing.map((entry) => `tarball is missing ${entry}`),
		...extra.map((entry) => `tarball contains unexpected ${entry}`),
	];
}

function run(command: string, args: string[], cwd: string): string {
	return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function main(): Promise<void> {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const release = process.argv.includes("--release");
	const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as PackageManifest;
	const errors = validatePackageMetadata(manifest, release);
	const workspace = await mkdtemp(join(tmpdir(), "pi-context-hint-package-"));

	try {
		const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", workspace], root)) as Array<{
			filename?: string;
			files?: Array<{ path: string }>;
		}>;
		const tarball = join(workspace, packed[0]?.filename ?? "");
		if (!packed[0]?.filename) {
			errors.push("npm pack did not return a tarball filename");
		} else {
			const entries = (packed[0].files ?? []).map((file) => `package/${file.path}`);
			errors.push(...validateTarballEntries(entries));

			const consumer = join(workspace, "consumer");
			await rm(consumer, { recursive: true, force: true });
			await mkdir(consumer, { recursive: true });
			await writeFile(join(consumer, "package.json"), '{"private":true}\n');
			run(
				"npm",
				["install", "--prefix", consumer, "--no-save", "--ignore-scripts", "--omit=dev", "--legacy-peer-deps", tarball],
				root,
			);
			const installedRoot = join(consumer, "node_modules", ...(manifest.name ?? "").split("/"));
			const installedManifest = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8")) as PackageManifest;
			const installedTarget = join(installedRoot, "extensions/context-hint.ts");
			const installedCore = join(installedRoot, "src/core.ts");
			if (installedManifest.pi?.extensions?.[0] !== "extensions/context-hint.ts") {
				errors.push("installed package manifest does not point to extensions/context-hint.ts");
			}
			for (const [path, description] of [[installedTarget, "extensions/context-hint.ts"], [installedCore, "src/core.ts"]]) {
				try {
					await readFile(path);
				} catch {
					errors.push(`installed package is missing ${description}`);
				}
			}

			const loader = new DefaultResourceLoader({
				cwd: consumer,
				agentDir: join(workspace, "agent"),
				additionalExtensionPaths: [installedRoot],
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
			});
			await loader.reload();
			const loaded = loader.getExtensions();
			if (loaded.errors.length > 0) {
				errors.push(`installed package extension failed to load: ${loaded.errors.map(({ error }) => error).join("; ")}`);
			}
			if (loaded.extensions.length !== 1 || !loaded.extensions[0]?.commands.has("context-hint")) {
				errors.push("installed package did not register exactly one context-hint command extension");
			}
		}
	} catch (error) {
		errors.push(error instanceof Error ? error.message : String(error));
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}

	if (errors.length > 0) {
		console.error(`${release ? "Release" : "Package"} check failed:`);
		for (const error of errors) console.error(`- ${error}`);
		process.exitCode = 1;
		return;
	}
	console.log(`${release ? "Release" : "Package"} check passed.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
