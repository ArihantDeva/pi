import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootPath = fileURLToPath(new URL("..", import.meta.url));

function changedFiles() {
	const tracked = execFileSync("mise", ["exec", "--", "git", "diff", "--name-only", "HEAD"], {
		cwd: rootPath,
		encoding: "utf8",
	});
	const untracked = execFileSync("mise", ["exec", "--", "git", "ls-files", "--others", "--exclude-standard"], {
		cwd: rootPath,
		encoding: "utf8",
	});
	return [...tracked.split("\n"), ...untracked.split("\n")].map((file) => file.trim()).filter(Boolean);
}

function commandsFor(files) {
	const toolFiles = files.every(
		(file) => file.startsWith("packages/coding-agent/src/core/tools/") || file === "packages/coding-agent/test/tools.test.ts",
	);
	if (files.length > 0 && toolFiles) {
		return [["npm", ["--prefix", "packages/coding-agent", "test", "--", "test/tools.test.ts", "--reporter=dot"]]];
	}
	if (files.length > 0 && files.every((file) => file.startsWith("packages/coding-agent/"))) {
		return [["npm", ["--prefix", "packages/coding-agent", "test", "--", "--reporter=dot"]]];
	}
	return [
		["npm", ["run", "check"]],
		["./test.sh", []],
		["npm", ["--prefix", "packages/tui", "run", "build"]],
		["npm", ["exec", "--", "tsgo", "-p", "packages/ai/tsconfig.build.json"]],
		["npm", ["--prefix", "packages/agent", "run", "build"]],
		["npm", ["--prefix", "packages/coding-agent", "run", "build"]],
		["npm", ["--prefix", "packages/orchestrator", "run", "build"]],
	];
}

function run(command, args) {
	const result = spawnSync("mise", ["exec", "--", command, ...args], {
		cwd: rootPath,
		stdio: "inherit",
	});
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

const files = changedFiles();
console.log(`Affected validation: ${files.length ? files.join(", ") : "no diff"}`);
for (const [command, args] of commandsFor(files)) run(command, args);
