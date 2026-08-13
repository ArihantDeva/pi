import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cache = mkdtempSync(join(tmpdir(), "pi-npm-cache-"));
const environment = { ...process.env, MISE_DISABLE_CACHE: "1", npm_config_cache: cache, npm_config_prefer_offline: "false" };

function run(command, args = []) {
	const result = spawnSync("mise", ["exec", "--", command, ...args], { cwd: root, env: environment, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
	run("npm", ["run", "check"]);
	run("./test.sh");
	run("npm", ["--prefix", "packages/tui", "run", "build"]);
	run("npm", ["exec", "--", "tsgo", "-p", "packages/ai/tsconfig.build.json"]);
	run("npm", ["--prefix", "packages/agent", "run", "build"]);
	run("npm", ["--prefix", "packages/coding-agent", "run", "build"]);
	run("npm", ["--prefix", "packages/orchestrator", "run", "build"]);
} finally {
	rmSync(cache, { recursive: true, force: true });
}
