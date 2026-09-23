import { describe, expect, it } from "vitest";
import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	fauxToolCall,
	type AssistantMessage,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai";

import { runDropper } from "../src/agents/dropper/agent.js";
import { DROPPER_SYSTEM } from "../src/agents/dropper/prompts.js";
import { runObserver } from "../src/agents/observer/agent.js";
import { OBSERVER_SYSTEM } from "../src/agents/observer/prompts.js";
import { runReflector } from "../src/agents/reflector/agent.js";
import { REFLECTOR_SYSTEM } from "../src/agents/reflector/prompts.js";
import { observation } from "./fixtures/session.js";

// These tests drive the real agent loop from the Pi packages under test, so a
// loop change that stops carrying the worker prompt or options fails here.

type Request = { context: TranscriptContext; options?: SimpleStreamOptions };

function scriptedStream(responses: AssistantMessage[], requests: Request[]) {
	return (_model: unknown, context: TranscriptContext, options?: SimpleStreamOptions) => {
		requests.push({ context: structuredClone(context), options });
		const message = responses.shift() ?? fauxAssistantMessage("done");
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => {
			stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message });
			stream.end(message);
		});
		return stream;
	};
}

function toolTurn(name: string, args: Record<string, unknown>): AssistantMessage {
	return fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
}

function systemText(request: Request): string {
	const first = request.context.messages[0];
	if (first?.role !== "system") return "";
	return typeof first.content === "string" ? first.content : first.content.map((part) => part.text).join("");
}

const model = { id: "worker", api: "faux", provider: "faux", reasoning: false, maxTokens: 4_096 } as any;

const recordedObservation = {
	timestamp: "2026-05-02 10:30",
	content: "User asked for a memory update.",
	relevance: "medium",
	sourceEntryIds: ["entry-a"],
};

const observerArgs = {
	model,
	apiKey: "test",
	priorReflections: [],
	priorObservations: [],
	chunk: "[Source entry id: entry-a]\nUser asked for a memory update.",
	allowedSourceEntryIds: ["entry-a"],
	maxTurns: 16,
};

describe("worker requests through the real agent loop", () => {
	it("sends the observer prompt, tool and session key, and ends on a complete batch", async () => {
		const requests: Request[] = [];
		const run = await runObserver({
			...observerArgs,
			sessionId: "session-1:om-observer",
			streamSimple: scriptedStream([
				toolTurn("record_observations", { observations: [recordedObservation], complete: true }),
			], requests) as any,
		});

		expect(run?.observations.map((item) => item.content)).toEqual(["User asked for a memory update."]);
		expect(run?.complete).toBe(true);
		expect(requests).toHaveLength(1);
		expect(systemText(requests[0])).toBe(OBSERVER_SYSTEM);
		expect(requests[0].context.messages[0]).toMatchObject({
			role: "system",
			toolsAdded: [expect.objectContaining({ name: "record_observations" })],
		});
		expect(requests[0].options?.sessionId).toBe("session-1:om-observer");
	});

	it("keeps the observer running after an incomplete or rejected batch", async () => {
		const requests: Request[] = [];
		await runObserver({
			...observerArgs,
			streamSimple: scriptedStream([
				toolTurn("record_observations", { observations: [recordedObservation], complete: false }),
				toolTurn("record_observations", {
					observations: [{ ...recordedObservation, content: "Invented source.", sourceEntryIds: ["entry-x"] }],
					complete: true,
				}),
				toolTurn("record_observations", { observations: [], complete: true }),
			], requests) as any,
		});

		expect(requests).toHaveLength(3);
	});

	it("stops the observer at the turn cap and reports the run incomplete", async () => {
		const requests: Request[] = [];
		const run = await runObserver({
			...observerArgs,
			maxTurns: 2,
			streamSimple: scriptedStream([
				toolTurn("record_observations", { observations: [recordedObservation], complete: false }),
				toolTurn("record_observations", { observations: [], complete: false }),
				toolTurn("record_observations", { observations: [], complete: false }),
			], requests) as any,
		});

		expect(requests).toHaveLength(2);
		expect(run?.complete).toBe(false);
	});

	it("treats a plain-text reply after recording as a finished run", async () => {
		const requests: Request[] = [];
		const run = await runObserver({
			...observerArgs,
			streamSimple: scriptedStream([
				toolTurn("record_observations", { observations: [recordedObservation] }),
				fauxAssistantMessage("Chunk covered."),
			], requests) as any,
		});

		expect(requests).toHaveLength(2);
		expect(run?.complete).toBe(true);
	});

	it("sends the reflector and dropper prompts and session keys", async () => {
		const obs = observation("aaaaaaaaaaaa", { tokenCount: 50 });
		const requests: Request[] = [];

		await runReflector({
			model,
			reflections: [],
			observations: [obs],
			sessionId: "session-1:om-reflector",
			streamSimple: scriptedStream([
				toolTurn("record_reflections", {
					reflections: [{ content: "User prefers terse replies.", supportingObservationIds: ["aaaaaaaaaaaa"] }],
					complete: true,
				}),
			], requests) as any,
		});
		await runDropper({
			model,
			reflections: [],
			observations: [obs],
			targetTokens: 1,
			sessionId: "session-1:om-dropper",
			streamSimple: scriptedStream([], requests) as any,
		});

		expect(requests).toHaveLength(2);
		expect(systemText(requests[0])).toBe(REFLECTOR_SYSTEM);
		expect(requests[0].options?.sessionId).toBe("session-1:om-reflector");
		expect(systemText(requests[1])).toBe(DROPPER_SYSTEM);
		expect(requests[1].options?.sessionId).toBe("session-1:om-dropper");
	});
});
