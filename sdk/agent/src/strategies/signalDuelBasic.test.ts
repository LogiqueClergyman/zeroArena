import assert from "node:assert/strict";
import { test } from "node:test";
import { SignalDuelBasicStrategy, chooseSignalMove } from "./signalDuelBasic.js";

test("Signal Duel basic strategy chooses an unused legal move when possible", () => {
  const move = chooseSignalMove({
    validMoves: ["rock", "paper", "scissors"],
    myPlayedMoves: ["rock"],
  }, "alpha");

  assert.ok(move === "paper" || move === "scissors");
});

test("Signal Duel basic fallback breaks mirrored commit state by player id", () => {
  const state = {
    phase: "commit",
    round: 3,
    validMoves: ["paper", "scissors"],
    myPlayedMoves: ["paper", "rock"],
  };

  assert.notEqual(chooseSignalMove(state, "alpha"), chooseSignalMove(state, "beta"));
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
