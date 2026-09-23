import { describe, expect, it } from "vitest";

import { workerTurnCap } from "../src/agents/loop-options.js";

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
