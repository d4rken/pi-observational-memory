import type { AgentContext, AgentLoopConfig, AgentTool } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";

/**
 * The worker's instructions travel as a leading system message that also
 * declares its tool; tests/worker-loop.test.ts pins this against the real loop.
 */
export function workerRun(systemPrompt: string, userText: string, tool: AgentTool<any>): { prompts: Message[]; context: AgentContext } {
	const timestamp = Date.now();
	return {
		prompts: [
			{ role: "system", content: systemPrompt, timestamp },
			{ role: "user", content: [{ type: "text", text: userText }], timestamp },
		],
		context: { messages: [], tools: [tool] },
	};
}

type FinishTurnHook = (turn: { message: { stopReason?: string } }) => { action: "end" } | undefined;

/**
 * Stops the loop after `maxTurns` completed turns. Pi 0.86 asks
 * `shouldStopAfterTurn`; Pi 0.87 replaced it with `finishTurn`, which also runs
 * for error/aborted turns that end the loop anyway. Each hook counts on its own.
 */
export function workerTurnCap(maxTurns: number | undefined): Partial<AgentLoopConfig> {
	if (!maxTurns || maxTurns <= 0) return {};
	let stopTurns = 0;
	let finishTurns = 0;
	const finishTurn: FinishTurnHook = (turn) => {
		if (turn.message.stopReason === "error" || turn.message.stopReason === "aborted") return undefined;
		return ++finishTurns >= maxTurns ? { action: "end" } : undefined;
	};
	const hooks = { shouldStopAfterTurn: () => ++stopTurns >= maxTurns, finishTurn };
	return hooks as Partial<AgentLoopConfig>;
}
