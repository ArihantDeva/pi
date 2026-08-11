import type { AgentSessionEvent } from "../../core/agent-session.ts";

/**
 * What the agent is doing right now, derived from the session event stream, so
 * the working loader can show more than a static "Working...".
 *
 * Ported from Prime Agent (PrimeIntellect-ai/prime-agent, MIT), adapted to the
 * pi-mono 0.80.x event shapes (AgentSessionEvent / AssistantMessageEvent).
 */
export type AgentActivity = "working" | "thinking" | "writing" | "writing-code" | "executing";

export interface AgentActivityStatus {
	activity: AgentActivity;
	/** "down" while receiving model output, "up" while sending (request in flight or tool executing). */
	direction: "down" | "up";
	/** Input tokens for the current turn (authoritative usage when reported, else a char/4 estimate). */
	inputTokens: number;
	/** Output tokens accumulated since the user's last message. */
	outputTokens: number;
}

export const AGENT_ACTIVITY_LABELS: Record<AgentActivity, string> = {
	working: "Working",
	thinking: "Thinking",
	writing: "Writing",
	"writing-code": "Writing code",
	executing: "Executing",
};

/** Fallback estimate for providers that only report usage when the message completes. */
const CHARS_PER_TOKEN_ESTIMATE = 4;

export class AgentActivityTracker {
	private activity: AgentActivity = "working";
	private completedTokens = 0;
	private streamingUsageTokens = 0;
	private streamingChars = 0;
	private inputTokens = 0;
	private runningToolCount = 0;
	// Providers like Anthropic only report usage at the start and end of a message, so the
	// live count leans on the character estimate in between. Keeping the reported value
	// monotonic prevents it from dipping when authoritative usage arrives at message end.
	private reportedTokens = 0;

	handleEvent(event: AgentSessionEvent): void {
		switch (event.type) {
			case "agent_start":
				this.activity = "working";
				this.runningToolCount = 0;
				break;

			case "message_start":
				if (event.message.role === "user") {
					this.reset();
					const content = event.message.content;
					const text =
						typeof content === "string" ? content : content.map((c) => ("text" in c ? c.text : "")).join("");
					this.inputTokens = Math.max(Math.round(text.length / CHARS_PER_TOKEN_ESTIMATE), 1);
				} else if (event.message.role === "assistant") {
					this.activity = "working";
					this.streamingUsageTokens = 0;
					this.streamingChars = 0;
				}
				break;

			case "message_update": {
				if (event.message.role !== "assistant") break;
				const streamEvent = event.assistantMessageEvent;
				if (!streamEvent) break;
				switch (streamEvent.type) {
					case "thinking_start":
					case "thinking_delta":
						this.activity = "thinking";
						break;
					case "text_start":
					case "text_delta":
						this.activity = "writing";
						break;
					case "toolcall_start":
					case "toolcall_delta":
						this.activity = "writing-code";
						break;
					default:
						break;
				}
				if ("delta" in streamEvent) {
					this.streamingChars += streamEvent.delta.length;
				}
				this.streamingUsageTokens = event.message.usage?.output ?? 0;
				break;
			}

			case "message_end":
				if (event.message.role !== "assistant") break;
				this.completedTokens +=
					(event.message.usage?.output ?? 0) > 0
						? (event.message.usage?.output ?? 0)
						: this.estimatedStreamingTokens();
				this.streamingUsageTokens = 0;
				this.streamingChars = 0;
				this.activity = "working";
				break;

			case "tool_execution_start":
				this.runningToolCount++;
				this.activity = "executing";
				break;

			case "tool_execution_end":
				this.runningToolCount = Math.max(0, this.runningToolCount - 1);
				if (this.runningToolCount === 0) {
					this.activity = "working";
				}
				break;

			default:
				break;
		}
		this.reportedTokens = Math.max(this.reportedTokens, this.currentTokens());
	}

	getStatus(): AgentActivityStatus {
		return {
			activity: this.activity,
			direction: this.activity === "working" || this.activity === "executing" ? "up" : "down",
			inputTokens: this.inputTokens,
			outputTokens: this.reportedTokens,
		};
	}

	private currentTokens(): number {
		return this.completedTokens + Math.max(this.streamingUsageTokens, this.estimatedStreamingTokens());
	}

	reset(): void {
		this.activity = "working";
		this.completedTokens = 0;
		this.streamingUsageTokens = 0;
		this.streamingChars = 0;
		this.runningToolCount = 0;
		this.reportedTokens = 0;
	}

	private estimatedStreamingTokens(): number {
		return Math.round(this.streamingChars / CHARS_PER_TOKEN_ESTIMATE);
	}
}

export function formatTokenCount(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}
