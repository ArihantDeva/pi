import type { AgentLoopConfig, ThinkingLevel } from "./types.ts";

/** Private contract for behavior experiments that reuse existing runtime surfaces. */
export interface BehaviorPolicy {
	promptGuidelines: readonly string[];
	thinkingLevel?: ThinkingLevel;
	shouldStopAfterTurn?: AgentLoopConfig["shouldStopAfterTurn"];
	prepareNextTurn?: AgentLoopConfig["prepareNextTurn"];
}

/** Metrics captured for one synthetic task execution. */
export interface BehaviorMeasurement {
	taskId: string;
	inputTokens?: number;
	outputTokens?: number;
	reasoningTokens?: number;
	totalTokens?: number;
	assistantTurns: number;
	toolCalls: number;
	success: boolean;
	retries: number;
	verification: "passed" | "failed" | "not-run";
	elapsedMs: number;
	error?: string;
}

export type BehaviorAcceptance =
	| {
			accepted: true;
			baselineMedianTokens: number;
			candidateMedianTokens: number;
			tokenReductionPercent: number;
			successRateRegressionPoints: number;
	  }
	| {
			accepted: false;
			reason:
				| "unavailable-token-metrics"
				| "insufficient-token-reduction"
				| "success-rate-regression"
				| "retry-regression";
			baselineMedianTokens?: number;
			candidateMedianTokens?: number;
			tokenReductionPercent?: number;
			successRateRegressionPoints?: number;
	  };

function median(values: readonly number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function successfulTokenTotals(measurements: readonly BehaviorMeasurement[]): number[] | undefined {
	const successful = measurements.filter((measurement) => measurement.success);
	if (successful.length === 0) return undefined;
	const totals = successful.map((measurement) => measurement.totalTokens);
	return totals.every((total) => typeof total === "number" && Number.isFinite(total))
		? (totals as number[])
		: undefined;
}

function rate(
	measurements: readonly BehaviorMeasurement[],
	select: (measurement: BehaviorMeasurement) => number,
): number {
	return measurements.reduce((total, measurement) => total + select(measurement), 0) / measurements.length;
}

/** Evaluate the locked 15% token, 2-point success, and no-retry-regression thresholds. */
export function evaluateBehaviorAcceptance(
	baseline: readonly BehaviorMeasurement[],
	candidate: readonly BehaviorMeasurement[],
): BehaviorAcceptance {
	const baselineTokens = successfulTokenTotals(baseline);
	const candidateTokens = successfulTokenTotals(candidate);
	if (!baselineTokens || !candidateTokens) {
		return { accepted: false, reason: "unavailable-token-metrics" };
	}

	const baselineMedianTokens = median(baselineTokens);
	const candidateMedianTokens = median(candidateTokens);
	if (baselineMedianTokens <= 0) {
		return { accepted: false, reason: "unavailable-token-metrics" };
	}

	const tokenReductionPercent = ((baselineMedianTokens - candidateMedianTokens) / baselineMedianTokens) * 100;
	const successRateRegressionPoints =
		(rate(baseline, (measurement) => Number(measurement.success)) -
			rate(candidate, (measurement) => Number(measurement.success))) *
		100;
	const candidateRetries = rate(candidate, (measurement) => measurement.retries);
	const baselineRetries = rate(baseline, (measurement) => measurement.retries);
	const metrics = { baselineMedianTokens, candidateMedianTokens, tokenReductionPercent, successRateRegressionPoints };

	if (tokenReductionPercent < 15) {
		return { accepted: false, reason: "insufficient-token-reduction", ...metrics };
	}
	if (successRateRegressionPoints > 2) {
		return { accepted: false, reason: "success-rate-regression", ...metrics };
	}
	if (candidateRetries > baselineRetries) {
		return { accepted: false, reason: "retry-regression", ...metrics };
	}
	return { accepted: true, ...metrics };
}
