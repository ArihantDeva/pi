import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createFindTool } from "../src/core/tools/find.ts";
import { createGrepTool } from "../src/core/tools/grep.ts";

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((content) => content.type === "text")
		.map((content) => content.text ?? "")
		.join("\n");
}

describe("search tool output limits", () => {
	let cwd: string;

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "coding-agent-output-limits-"));
	});

	afterEach(() => {
		rmSync(cwd, { recursive: true, force: true });
	});

	test("find caps a backend result at 500 output lines", async () => {
		const find = createFindTool(cwd, {
			operations: {
				exists: () => true,
				glob: (pattern, root, options) => {
					expect(pattern).toBe("*");
					expect(options.limit).toBe(700);
					return Array.from({ length: 600 }, (_, index) => join(root, `file-${index}`));
				},
			},
		});

		const result = await find.execute("find-output-limit", { pattern: "*", limit: 700 });

		expect(result.details?.truncation?.truncated).toBe(true);
		expect(result.details?.truncation?.truncatedBy).toBe("lines");
		expect(result.details?.truncation?.outputLines).toBe(500);
		expect(textOf(result)).toContain("500 lines limit reached");
	});

	test("grep caps matches at 500 output lines even with a higher match limit", async () => {
		const file = join(cwd, "matches.txt");
		writeFileSync(file, Array.from({ length: 600 }, (_, index) => `needle-${index}`).join("\n"));
		const grep = createGrepTool(cwd, {
			operations: {
				isDirectory: () => false,
				readFile: (path) => readFileSync(path, "utf8"),
			},
		});

		const result = await grep.execute("grep-output-limit", { pattern: "needle", path: file, limit: 600 });

		expect(result.details?.truncation?.truncated).toBe(true);
		expect(result.details?.truncation?.truncatedBy).toBe("lines");
		expect(result.details?.truncation?.outputLines).toBe(500);
		expect(textOf(result)).toContain("500 lines limit reached");
	});
});
