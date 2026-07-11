import {
	type BehaviorAcceptance,
	type BehaviorMeasurement,
	type BehaviorPolicy,
	evaluateBehaviorAcceptance,
} from "./behavior-policy.ts";

export type BehaviorBenchmarkDomain = "navigation-review" | "bug-fixing" | "feature-implementation";

export interface BehaviorBenchmarkTask {
	id: string;
	domain: BehaviorBenchmarkDomain;
	prompt: string;
	oracle: (output: unknown) => boolean;
}

export interface BehaviorBenchmarkArm {
	id:
		| "baseline"
		| "stop-loop-discipline"
		| "concise-execution"
		| "conditional-verification"
		| "adaptive-reasoning"
		| "model-specific-profile"
		| "candidate-policy-search"
		| "combined-candidate";
	policy: BehaviorPolicy;
}

export interface BehaviorBenchmarkExecution {
	inputTokens?: number;
	outputTokens?: number;
	reasoningTokens?: number;
	totalTokens?: number;
	assistantTurns: number;
	toolCalls: number;
	retries: number;
	verification: BehaviorMeasurement["verification"];
	elapsedMs: number;
	output: unknown;
	error?: string;
}

export type BehaviorBenchmarkExecutor = (
	task: BehaviorBenchmarkTask,
	arm: BehaviorBenchmarkArm,
) => Promise<BehaviorBenchmarkExecution>;

export interface BehaviorBenchmarkResult {
	arm: BehaviorBenchmarkArm;
	status: "completed" | "unavailable" | "failed" | "rejected";
	measurements: BehaviorMeasurement[];
	reason?: string;
	failureReasons: string[];
	acceptance?: BehaviorAcceptance;
}

export interface BehaviorBenchmarkReport {
	baseline: BehaviorBenchmarkResult;
	candidates: BehaviorBenchmarkResult[];
}

function task(id: string, domain: BehaviorBenchmarkDomain, prompt: string): BehaviorBenchmarkTask {
	return { id, domain, prompt, oracle: (output) => output === id };
}

/** Fixed, disposable corpus: three tasks in each approved domain. */
export const BEHAVIOR_BENCHMARK_TASKS: readonly BehaviorBenchmarkTask[] = [
	task("navigation-locate", "navigation-review", "Locate a named behavior."),
	task("navigation-explain", "navigation-review", "Explain a local flow."),
	task("navigation-defect", "navigation-review", "Identify a contained defect."),
	task("bug-reproduce", "bug-fixing", "Reproduce a contained defect."),
	task("bug-fix", "bug-fixing", "Fix a contained defect."),
	task("bug-verify", "bug-fixing", "Verify a focused fix."),
	task("feature-add", "feature-implementation", "Add a small local behavior."),
	task("feature-test", "feature-implementation", "Add a focused test."),
	task("feature-verify", "feature-implementation", "Verify a local feature."),
];

/** Baseline plus every approved experiment arm; these policies are benchmark-only. */
export const BEHAVIOR_BENCHMARK_ARMS: readonly BehaviorBenchmarkArm[] = [
	{ id: "baseline", policy: { promptGuidelines: [] } },
	{
		id: "stop-loop-discipline",
		policy: { promptGuidelines: ["Avoid unchanged repeated tools and stop after verified completion."] },
	},
	{ id: "concise-execution", policy: { promptGuidelines: ["Execute concisely without omitting required evidence."] } },
	{
		id: "conditional-verification",
		policy: { promptGuidelines: ["Verify only when risk or uncertainty warrants it, then stop after success."] },
	},
	{
		id: "adaptive-reasoning",
		policy: {
			promptGuidelines: ["Escalate reasoning only after ambiguity, tool failure, or verification failure."],
			thinkingLevel: "low",
		},
	},
	{
		id: "model-specific-profile",
		policy: {
			promptGuidelines: ["Apply a model-specific profile only when existing metadata distinguishes the model."],
		},
	},
	{
		id: "candidate-policy-search",
		policy: { promptGuidelines: ["Use the smallest effective combination of approved behavior instructions."] },
	},
	{ id: "combined-candidate", policy: { promptGuidelines: [] } },
];

function unavailable(arm: BehaviorBenchmarkArm, reason: string): BehaviorBenchmarkResult {
	return { arm, status: "unavailable", measurements: [], reason, failureReasons: [] };
}

async function runArm(
	tasks: readonly BehaviorBenchmarkTask[],
	arm: BehaviorBenchmarkArm,
	execute: BehaviorBenchmarkExecutor | undefined,
): Promise<BehaviorBenchmarkResult> {
	if (!execute) return unavailable(arm, "provider-unavailable");

	const measurements: BehaviorMeasurement[] = [];
	const failureReasons: string[] = [];
	for (const benchmarkTask of tasks) {
		const startedAt = Date.now();
		try {
			const execution = await execute(benchmarkTask, arm);
			if (execution.error) failureReasons.push(execution.error);
			measurements.push({
				taskId: benchmarkTask.id,
				inputTokens: execution.inputTokens,
				outputTokens: execution.outputTokens,
				reasoningTokens: execution.reasoningTokens,
				totalTokens: execution.totalTokens,
				assistantTurns: execution.assistantTurns,
				toolCalls: execution.toolCalls,
				success: !execution.error && benchmarkTask.oracle(execution.output),
				retries: execution.retries,
				verification: execution.verification,
				elapsedMs: execution.elapsedMs,
				error: execution.error,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			failureReasons.push(message);
			measurements.push({
				taskId: benchmarkTask.id,
				assistantTurns: 0,
				toolCalls: 0,
				success: false,
				retries: 0,
				verification: "failed",
				elapsedMs: Date.now() - startedAt,
				error: message,
			});
		}
	}

	return {
		arm,
		status: failureReasons.length === 0 ? "completed" : "failed",
		measurements,
		failureReasons,
	};
}

function combinedArm(candidates: readonly BehaviorBenchmarkResult[]): BehaviorBenchmarkArm {
	return {
		id: "combined-candidate",
		policy: {
			promptGuidelines: candidates.flatMap((candidate) => candidate.arm.policy.promptGuidelines),
		},
	};
}

/** Runs the local corpus through an already-configured test or provider execution seam. */
export async function runBehaviorBenchmark(
	options: { tasks?: readonly BehaviorBenchmarkTask[]; execute?: BehaviorBenchmarkExecutor } = {},
): Promise<BehaviorBenchmarkReport> {
	const tasks = options.tasks ?? BEHAVIOR_BENCHMARK_TASKS;
	const [baselineArm, ...variantArms] = BEHAVIOR_BENCHMARK_ARMS;
	if (!baselineArm) throw new Error("Missing baseline benchmark arm");

	const baseline = await runArm(tasks, baselineArm, options.execute);
	const candidates: BehaviorBenchmarkResult[] = [];
	for (const arm of variantArms) {
		if (arm.id === "combined-candidate") continue;
		const candidate = await runArm(tasks, arm, options.execute);
		if (baseline.status === "completed" && candidate.status === "completed") {
			candidate.acceptance = evaluateBehaviorAcceptance(baseline.measurements, candidate.measurements);
		}
		candidates.push(candidate);
	}

	const passingCandidates = candidates.filter((candidate) => candidate.acceptance?.accepted === true);
	const combined = combinedArm(passingCandidates);
	if (passingCandidates.length === 0) {
		candidates.push({
			arm: combined,
			status: "rejected",
			measurements: [],
			reason: "no-independently-accepted-candidates",
			failureReasons: [],
		});
	} else {
		const candidate = await runArm(tasks, combined, options.execute);
		if (baseline.status === "completed" && candidate.status === "completed") {
			candidate.acceptance = evaluateBehaviorAcceptance(baseline.measurements, candidate.measurements);
		}
		candidates.push(candidate);
	}

	return { baseline, candidates };
}
