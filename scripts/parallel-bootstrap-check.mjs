import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const checks = [
	["mise", ["tasks", "validate"]],
	["mise", ["exec", "--", "node", "--check", "scripts/affected-coding-agent.mjs"]],
];

function run([command, args]) {
	return new Promise((resolve) => {
		const child = spawn(command, args, { cwd: root, stdio: "inherit" });
		child.on("error", () => resolve(1));
		child.on("close", (status) => resolve(status ?? 1));
	});
}

const statuses = await Promise.all(checks.map(run));
if (statuses.some((status) => status !== 0)) process.exit(1);
