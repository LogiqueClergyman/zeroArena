import assert from "node:assert/strict";
import { test } from "node:test";
import { SignalDuelBasicStrategy, chooseSignalMove } from "./signalDuelBasic.js";

test("Signal Duel basic strategy chooses an unused legal move when possible", () => {
  assert.equal(chooseSignalMove({
    validMoves: ["rock", "paper", "scissors"],
    myPlayedMoves: ["rock"],
  }), "paper");
});

test("Signal Duel fallback dialogue varies by player and transcript", () => {
  const strategy = new SignalDuelBasicStrategy();
  const first = strategy.fallback({
    publicState: { phase: "dialogue", dialogue: [] },
    playerId: "alpha",
    reason: "test",
  }).action;
  const second = strategy.fallback({
    publicState: { phase: "dialogue", dialogue: [{ message: "x" }] },
    playerId: "beta",
    reason: "test",
  }).action;

  assert.equal((first as { phase: string }).phase, "dialogue");
  assert.equal((second as { phase: string }).phase, "dialogue");
  assert.notEqual((first as { message: string }).message, (second as { message: string }).message);
});
