import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

/**
 * Persistent IPython kernel tool (Prime-style RLM surface).
 *
 * Spawns one jupyter_client-driven IPython kernel per tool instance (per
 * session) and keeps it alive: variables, imports, and module state survive
 * across calls. Communication is JSON lines over stdin/stdout to the
 * scripts/ipython-driver.py driver, which owns the kernel process.
 *
 * Falls back to `python3 -c` semantics only if the driver cannot start.
 */

const ipythonSchema = Type.Object({
	cell: Type.String({ description: "Python code to execute in the persistent IPython kernel" }),
	timeout: Type.Optional(Type.Number({ description: "Seconds before the cell is interrupted (default 30)" })),
});

type IPythonArgs = Static<typeof ipythonSchema>;

const DEFAULT_TIMEOUT_S = 30;
const DEFAULT_MAX_OUTPUT_CHARS = 65_536;

interface PendingRequest {
	resolve: (output: string) => void;
	reject: (err: Error) => void;
	seq: number;
}

/** Serializes concurrent execute() calls onto the single line-protocol channel. */
class IPythonKernel {
	private readonly pythonPath: string;
	private readonly driverPath: string;
	private readonly cwd: string;
	private proc: ChildProcess | undefined;
	private pending = new Map<number, PendingRequest>();
	private seq = 0;
	private chain: Promise<unknown> = Promise.resolve();
	private stderrTail = "";
	private failed = false;

	constructor(pythonPath: string, driverPath: string, cwd: string) {
		this.pythonPath = pythonPath;
		this.driverPath = driverPath;
		this.cwd = cwd;
		// The driver child keeps the event loop alive; tear it down with the host
		// so CLI one-shots and test harnesses exit cleanly.
		const onExit = () => this.dispose();
		process.on("exit", onExit);
		process.on("SIGINT", onExit);
		process.on("SIGTERM", onExit);
	}

	private ensureStarted(): void {
		if (this.proc && this.proc.exitCode === null) return;
		this.failed = false;
		this.proc = spawn(this.pythonPath, [this.driverPath], {
			cwd: this.cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.proc.stderr?.on("data", (d: Buffer) => {
			this.stderrTail = (this.stderrTail + d.toString()).slice(-2048);
		});
		this.proc.on("exit", (code) => {
			this.failed = true;
			for (const p of this.pending.values()) {
				p.reject(new Error(`ipython kernel exited (code ${code}): ${this.stderrTail.slice(-500)}`));
			}
			this.pending.clear();
		});
		createInterface({ input: this.proc.stdout! }).on("line", (line) => {
			try {
				const msg = JSON.parse(line) as { seq?: number; output?: string; error?: string | null };
				const p = this.pending.get(msg.seq ?? -1);
				if (!p) return;
				this.pending.delete(p.seq);
				if (msg.error) {
					p.reject(new Error(msg.error.slice(0, DEFAULT_MAX_OUTPUT_CHARS)));
				} else {
					p.resolve((msg.output ?? "").slice(0, DEFAULT_MAX_OUTPUT_CHARS));
				}
			} catch {
				// malformed line — ignore
			}
		});
	}

	execute(cell: string, timeoutS: number): Promise<string> {
		const run = (): Promise<string> => {
			this.ensureStarted();
			if (this.failed) {
				return Promise.reject(new Error(`ipython kernel unavailable: ${this.stderrTail.slice(-300)}`));
			}
			const seq = ++this.seq;
			return new Promise<string>((resolve, reject) => {
				this.pending.set(seq, { resolve, reject, seq });
				const payload = JSON.stringify({ seq, code: cell, timeout: timeoutS }) + "\n";
				this.proc?.stdin?.write(payload);
			});
		};
		// Serialize: one cell at a time on the single channel.
		const result = this.chain.then(run);
		this.chain = result.catch(() => undefined);
		return result;
	}

	interrupt(): void {
		this.proc?.stdin?.write(JSON.stringify({ seq: 0, interrupt: true }) + "\n");
	}

	dispose(): void {
		try {
			this.proc?.stdin?.end();
		} catch {
			// already closed
		}
		setTimeout(() => {
			if (this.proc && this.proc.exitCode === null) this.proc.kill();
		}, 500).unref?.();
	}
}

/** Locate the driver script next to this module (src or dist layout) and the venv python. */
function resolvePaths(cwd: string): { pythonPath: string; driverPath: string } {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		join(here, "../../../scripts/ipython-driver.py"), // dist/core/tools -> packages/coding-agent/scripts
		join(here, "../../scripts/ipython-driver.py"), // src/core/tools -> src/scripts (dev)
	];
	const driverPath = candidates.find((p) => existsSync(p)) ?? candidates[0];
	const packageRoot = join(here, "../../.."); // packages/coding-agent (both layouts)
	const venvPython = join(packageRoot, ".venv-ipython/bin/python");
	const pythonPath = existsSync(venvPython) ? venvPython : "python3";
	return { pythonPath, driverPath, cwd } as unknown as { pythonPath: string; driverPath: string };
}

export function createIPythonTool(cwd: string): AgentTool<typeof ipythonSchema> {
	let kernel: IPythonKernel | undefined;

	return wrapToolDefinition({
		name: "ipython",
		label: "ipython",
		description:
			"Execute Python code in a persistent IPython kernel. Variables, imports, and module state survive across calls — the kernel stays alive for the whole session. Use for data exploration, transformations, and computations that need to keep state between steps.",
		promptSnippet: "Execute Python in a persistent IPython kernel (state survives across calls)",
		parameters: ipythonSchema,
		async execute(_toolCallId, { cell, timeout }: IPythonArgs, signal?: AbortSignal) {
			const effectiveTimeout = timeout && timeout > 0 ? timeout : DEFAULT_TIMEOUT_S;
			if (!kernel) {
				const { pythonPath, driverPath } = resolvePaths(cwd);
				kernel = new IPythonKernel(pythonPath, driverPath, cwd);
			}
			const runPromise = kernel.execute(cell, effectiveTimeout);
			let finished = false;
			const abort = () => {
				if (!finished) kernel?.interrupt();
			};
			signal?.addEventListener("abort", abort, { once: true });
			const runTimer = setTimeout(() => abort(), (effectiveTimeout + 3) * 1000);
			try {
				const output = await runPromise;
				return { content: [{ type: "text", text: output }], details: undefined };
			} finally {
				finished = true;
				clearTimeout(runTimer);
				signal?.removeEventListener("abort", abort);
			}
		},
	});
}
