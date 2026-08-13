import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	type Component,
	Container,
	Markdown,
	type MarkdownTheme,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { keyText } from "./keybinding-hints.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/** Thinking traces render quiet: same structure, muted color, no italics. */
function getThinkingMarkdownTheme(baseTheme: MarkdownTheme): MarkdownTheme {
	const quiet = (text: string) => theme.fg("thinkingText", text);
	return {
		...baseTheme,
		heading: quiet,
		link: quiet,
		linkUrl: quiet,
		code: quiet,
		codeBlock: quiet,
		codeBlockBorder: quiet,
		quote: quiet,
		quoteBorder: quiet,
		hr: quiet,
		listBullet: quiet,
		highlightCode: (code: string) => code.split("\n").map((line) => quiet(line)),
	};
}

function thinkingToggleHint(description: string): string {
	return `(${keyText("app.thinking.toggle")} ${description})`;
}

/** Single collapsed-thinking row that truncates the recap to the render width instead of wrapping. */
class CollapsedThinkingRow implements Component {
	private readonly label: string;
	private readonly recap: string;
	private readonly hint: string;

	constructor(label: string, recap: string, hint: string) {
		this.label = label;
		this.recap = recap;
		this.hint = hint;
	}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		const separator = theme.fg("dim", " · ");
		const fixedWidth = visibleWidth(` ${this.label}${separator} ${this.hint}`);
		const recapWidth = Math.max(8, safeWidth - fixedWidth);
		const recap = theme.fg("thinkingText", truncateToWidth(this.recap, recapWidth));
		return [truncateToWidth(` ${this.label}${separator}${recap} ${this.hint}`, safeWidth, "")];
	}

	invalidate(): void {}
}

/**
 * One-line recap for a collapsed thinking block: the last bold section header
 * when the trace has one (reasoning summaries usually do), otherwise the first
 * non-empty line, stripped of markdown emphasis and truncated.
 */
export function thinkingRecap(thinking: string, fallback: string, maxWidth = 120): string {
	const lines = thinking
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const lastHeader = [...lines].reverse().find((line) => /^\*\*[^*]+\*\*:?$/.test(line) || /^#{1,6}\s+\S/.test(line));
	const source = lastHeader ?? lines[0] ?? fallback;
	const plain = source
		.replace(/^#{1,6}\s+/, "")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/\*([^*]+)\*/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\s+/g, " ")
		.replace(/:$/, "")
		.trim();
	return truncateToWidth(plain || fallback, Math.max(20, maxWidth));
}

/**
 * Component that renders a complete assistant message.
 *
 * Streaming is incremental: while the content structure is stable, updates
 * reduce to setText() on the changed block(s). Any structural change (a new
 * block, the collapsed-thinking recap, hide/expand toggle) triggers a rebuild.
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private hiddenThinkingLabel: string;
	private outputPad: number;
	private lastMessage?: AssistantMessage;
	private hasToolCalls = false;
	private dirty = false;
	private lastSignature?: string;
	private blockMarkdowns = new Map<number, Markdown>();
	private lastBlockTexts = new Map<number, string>();

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		hiddenThinkingLabel = "Thinking...",
		outputPad = 1,
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;
		this.hiddenThinkingLabel = hiddenThinkingLabel;
		this.outputPad = outputPad;

		// Container for text/thinking content
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	override invalidate(): void {
		super.invalidate();
		// Force a full rebuild so theme-dependent children are recreated.
		this.lastSignature = undefined;
		this.dirty = true;
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
		this.dirty = true;
	}

	setHiddenThinkingLabel(label: string): void {
		this.hiddenThinkingLabel = label;
		this.dirty = true;
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
		this.dirty = true;
	}

	override render(width: number): string[] {
		if (this.dirty && this.lastMessage) {
			this.reconcile(this.lastMessage);
			this.dirty = false;
		}
		const lines = super.render(width);
		if (this.hasToolCalls || lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}

	updateContent(message: AssistantMessage): void {
		this.lastMessage = message;
		this.dirty = true;
	}

	/**
	 * Everything that affects child component identity/order, but not the text
	 * inside a block. While the signature is stable, updates reduce to setText()
	 * on changed blocks; any structural change triggers a full rebuild.
	 */
	private computeSignature(message: AssistantMessage): string {
		const parts: string[] = [];
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text") {
				parts.push(`${i}:text:${content.text.trim() ? 1 : 0}`);
			} else if (content.type === "thinking") {
				parts.push(`${i}:thinking:${content.thinking.trim() ? 1 : 0}`);
				if (this.hideThinkingBlock && content.thinking.trim()) {
					// The collapsed row bakes the recap into a static line, so a recap
					// change must count as a structural change during streaming.
					// JSON-encode the free text so it cannot forge part boundaries.
					parts.push(`${i}:recap:${JSON.stringify(thinkingRecap(content.thinking, this.hiddenThinkingLabel))}`);
				}
			} else {
				parts.push(`${i}:${content.type}`);
			}
		}
		parts.push(
			`hide:${this.hideThinkingBlock}`,
			`label:${this.hiddenThinkingLabel}`,
			`pad:${this.outputPad}`,
			`stop:${message.stopReason ?? ""}`,
			`error:${message.errorMessage ?? ""}`,
		);
		return parts.join("|");
	}

	private reconcile(message: AssistantMessage): void {
		const signature = this.computeSignature(message);
		if (signature !== this.lastSignature) {
			this.lastSignature = signature;
			this.rebuild(message);
			return;
		}

		// Structure unchanged: update only blocks whose text changed (during
		// streaming that is just the final block).
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			const markdown = this.blockMarkdowns.get(i);
			if (!markdown) continue;
			let text: string | undefined;
			if (content.type === "text") {
				text = content.text.trim();
			} else if (content.type === "thinking") {
				text = content.thinking.trim();
			}
			if (text !== undefined && text !== this.lastBlockTexts.get(i)) {
				this.lastBlockTexts.set(i, text);
				markdown.setText(text);
			}
		}
	}

	private rebuild(message: AssistantMessage): void {
		// Clear content container
		this.contentContainer.clear();
		this.blockMarkdowns.clear();
		this.lastBlockTexts.clear();

		const hasVisibleContent = message.content.some(
			(c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
		);

		if (hasVisibleContent) {
			this.contentContainer.addChild(new Spacer(1));
		}

		// Render content in order
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				const markdown = new Markdown(content.text.trim(), this.outputPad, 0, this.markdownTheme);
				this.blockMarkdowns.set(i, markdown);
				this.lastBlockTexts.set(i, content.text.trim());
				this.contentContainer.addChild(markdown);
			} else if (content.type === "thinking" && content.thinking.trim()) {
				// Add spacing only when another visible assistant content block follows.
				const hasVisibleContentAfter = message.content
					.slice(i + 1)
					.some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));

				const thinkingLabel = theme.bold(theme.fg("thinkingText", this.hiddenThinkingLabel));
				if (this.hideThinkingBlock) {
					// Collapsed row: bold label, a one-line recap of the trace, and the
					// toggle hint. The row truncates the recap to the render width so it
					// never wraps onto a second line on narrow terminals.
					this.contentContainer.addChild(
						new CollapsedThinkingRow(
							thinkingLabel,
							thinkingRecap(content.thinking, this.hiddenThinkingLabel),
							thinkingToggleHint("to expand"),
						),
					);
					if (hasVisibleContentAfter) {
						this.contentContainer.addChild(new Spacer(1));
					}
				} else {
					// Expanded: the same label line with the toggle hint, then the trace.
					// Thinking traces keep Markdown structure but stay visually quiet.
					this.contentContainer.addChild(
						new Text(`${thinkingLabel} ${thinkingToggleHint("to collapse")}`, this.outputPad, 0),
					);
					const markdown = new Markdown(
						content.thinking.trim(),
						this.outputPad,
						0,
						getThinkingMarkdownTheme(this.markdownTheme),
						{
							color: (text: string) => theme.fg("thinkingText", text),
						},
					);
					this.blockMarkdowns.set(i, markdown);
					this.lastBlockTexts.set(i, content.thinking.trim());
					this.contentContainer.addChild(markdown);
					if (hasVisibleContentAfter) {
						this.contentContainer.addChild(new Spacer(1));
					}
				}
			}
		}

		// Check if incomplete/failed - show after partial content.
		// Length stops can happen before a tool call is complete, so surface them here too.
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		this.hasToolCalls = hasToolCalls;
		if (message.stopReason === "length") {
			this.contentContainer.addChild(new Spacer(1));
			this.contentContainer.addChild(
				new Text(
					theme.fg(
						"error",
						"Error: Model stopped because it reached the maximum output token limit. The response may be incomplete.",
					),
					this.outputPad,
					0,
				),
			);
		} else if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", abortMessage), this.outputPad, 0));
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), this.outputPad, 0));
			}
		}
	}
}
