import { describe, expect, it } from "vitest";
import { BEHAVIOR_BENCHMARK_ARMS, BEHAVIOR_BENCHMARK_TASKS, runBehaviorBenchmark } from "../src/behavior-benchmark.ts";

describe("behavior efficiency benchmark", () => {
	it("runs isolated baseline and candidate measurements across three synthetic domains", async () => {
		const executions: string[] = [];
		const report = await runBehaviorBenchmark({
			execute: async (task, arm) => {
				executions.push(`${task.id}:${arm.id}`);
				return {
					inputTokens: 40,
					outputTokens: arm.id === "baseline" ? 60 : 40,
					reasoningTokens: 0,
					totalTokens: arm.id === "baseline" ? 100 : 80,
					assistantTurns: 1,
					toolCalls: 1,
					retries: 0,
					verification: "passed",
					elapsedMs: 10,
					output: task.id,
				};
			},
		});

		expect(new Set(BEHAVIOR_BENCHMARK_TASKS.map((task) => task.domain))).toEqual(
			new Set(["navigation-review", "bug-fixing", "feature-implementation"]),
		);
		expect(BEHAVIOR_BENCHMARK_TASKS).toHaveLength(9);
		expect(BEHAVIOR_BENCHMARK_ARMS.map((arm) => arm.id)).toEqual([
			"baseline",
			"stop-loop-discipline",
			"concise-execution",
			"conditional-verification",
			"adaptive-reasoning",
			"model-specific-profile",
			"candidate-policy-search",
			"combined-candidate",
		]);
		expect(executions).toHaveLength(BEHAVIOR_BENCHMARK_TASKS.length * BEHAVIOR_BENCHMARK_ARMS.length);
		expect(new Set(executions)).toHaveLength(executions.length);
		expect(report.baseline.measurements).toHaveLength(9);
		expect(report.candidates.find((candidate) => candidate.arm.id === "stop-loop-discipline")).toMatchObject({
			status: "completed",
			acceptance: { accepted: true, tokenReductionPercent: 20, successRateRegressionPoints: 0 },
		});
	});

	it("uses task oracles instead of executor success claims and records complete metrics", async () => {
		const report = await runBehaviorBenchmark({
			execute: async (task, arm) => ({
				inputTokens: 10,
				outputTokens: 20,
				reasoningTokens: 30,
				totalTokens: 60,
				assistantTurns: 2,
				toolCalls: 3,
				retries: 1,
				verification: "failed",
				elapsedMs: 40,
				output: arm.id === "baseline" && task.id === "navigation-locate" ? "wrong" : task.id,
			}),
		});

		const failedMeasurement = report.baseline.measurements.find(
			(measurement) => measurement.taskId === "navigation-locate",
		);
		expect(failedMeasurement).toMatchObject({
			inputTokens: 10,
			outputTokens: 20,
			reasoningTokens: 30,
			totalTokens: 60,
			assistantTurns: 2,
			toolCalls: 3,
			success: false,
			retries: 1,
			verification: "failed",
			elapsedMs: 40,
		});
	});

	it("records unavailable providers and execution failure reasons without claiming savings", async () => {
		const unavailable = await runBehaviorBenchmark();
		expect(unavailable.baseline).toMatchObject({ status: "unavailable", reason: "provider-unavailable" });
		expect(unavailable.candidates).toEqual(
			expect.arrayContaining([expect.objectContaining({ status: "unavailable", reason: "provider-unavailable" })]),
		);

		const failed = await runBehaviorBenchmark({
			execute: async () => {
				throw new Error("provider timed out");
			},
		});
		expect(failed.baseline).toMatchObject({ status: "failed" });
		expect(failed.baseline.failureReasons).toEqual(expect.arrayContaining(["provider timed out"]));
		expect(failed.baseline.measurements.every((measurement) => measurement.success === false)).toBe(true);
	});
});
