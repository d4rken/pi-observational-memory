import { describe, expect, it } from "vitest";

import { workerSessionId, workerTurnCap } from "../src/agents/loop-options.js";

describe("workerSessionId", () => {
	it("suffixes the session id with the worker stage", () => {
		expect(workerSessionId("0198c6f2-7a1b-7c3d-8e4f-5a6b7c8d9e0f", "observer")).toBe("0198c6f2-7a1b-7c3d-8e4f-5a6b7c8d9e0f:om-observer");
		expect(workerSessionId(undefined, "dropper")).toBeUndefined();
		expect(workerSessionId("", "dropper")).toBeUndefined();
	});

	it("hashes a long session id so the stage suffix survives a 64-character key limit", () => {
		const long = "x".repeat(80);
		const observer = workerSessionId(long, "observer")!;
		const reflector = workerSessionId(long, "reflector")!;

		expect(observer).toMatch(/^[a-f0-9]{32}:om-observer$/);
		expect(reflector).toMatch(/^[a-f0-9]{32}:om-reflector$/);
		expect(observer.slice(0, 32)).toBe(reflector.slice(0, 32));
		expect(workerSessionId(`${long}y`, "observer")).not.toBe(observer);
	});
});

describe("workerTurnCap", () => {
	it("is absent without a positive cap", () => {
		expect(workerTurnCap(undefined)).toEqual({});
		expect(workerTurnCap(0)).toEqual({});
	});

	it("stops after maxTurns through shouldStopAfterTurn", () => {
		const { shouldStopAfterTurn } = workerTurnCap(2) as any;

		expect(shouldStopAfterTurn({})).toBe(false);
		expect(shouldStopAfterTurn({})).toBe(true);
	});

	it("ends after maxTurns through finishTurn without counting failed turns", () => {
		const { finishTurn } = workerTurnCap(2) as any;

		expect(finishTurn({ message: { stopReason: "error" } })).toBeUndefined();
		expect(finishTurn({ message: { stopReason: "aborted" } })).toBeUndefined();
		expect(finishTurn({ message: { stopReason: "toolUse" } })).toBeUndefined();
		expect(finishTurn({ message: { stopReason: "stop" } })).toEqual({ action: "end" });
	});

	it("counts each hook separately", () => {
		const { shouldStopAfterTurn, finishTurn } = workerTurnCap(2) as any;

		expect(shouldStopAfterTurn({})).toBe(false);
		expect(finishTurn({ message: { stopReason: "toolUse" } })).toBeUndefined();
		expect(shouldStopAfterTurn({})).toBe(true);
	});
});
