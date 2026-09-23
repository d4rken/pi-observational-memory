import { createHash } from "node:crypto";
import type { AgentContext, AgentLoopConfig, AgentTool } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";

export const WORKER_STAGES = ["observer", "reflector", "dropper"] as const;
export type WorkerStage = (typeof WORKER_STAGES)[number];

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

/** pi-ai clamps OpenAI prompt-cache keys to this length, which would cut off the worker suffix. */
const MAX_WORKER_SESSION_ID_LENGTH = 64;

/**
 * Prompt-cache and affinity key for one worker of one session, e.g.
 * `0198c6f2-…:om-observer`. Workers never share the session's own key: their
 * prompts share no prefix with the conversation, and a transport that keys a
 * connection on the session id would otherwise carry both.
 */
export function workerSessionId(sessionId: string | undefined, stage: WorkerStage): string | undefined {
	if (!sessionId) return undefined;
	const suffix = `:om-${stage}`;
	const key = `${sessionId}${suffix}`;
	if (key.length <= MAX_WORKER_SESSION_ID_LENGTH) return key;
	return `${createHash("sha256").update(sessionId).digest("hex").slice(0, 32)}${suffix}`;
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

