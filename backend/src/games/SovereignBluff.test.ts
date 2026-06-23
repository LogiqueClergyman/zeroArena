import assert from "node:assert/strict";
import { test } from "node:test";
import { SovereignBluff } from "./SovereignBluff.js";
import type { GameState } from "../core/types.js";

const players = ["alpha", "beta"];

function activeState(): { engine: SovereignBluff; state: GameState } {
  const engine = new SovereignBluff();
  const state = engine.initState(players);
  state.status = "active";
  return { engine, state };
}

function submitRound(
  engine: SovereignBluff,
  state: GameState,
  alphaBid: number,
  betaBid: number,
): GameState {
  state = engine.applyMove(
    state,
    { phase: "broadcast", message: "Alpha says I am bidding high." },
    "alpha",
  );
  state = engine.applyMove(
    state,
    { phase: "broadcast", message: "Beta offers a truce." },
    "beta",
  );
  state = engine.applyMove(state, { phase: "bid", amount: alphaBid }, "alpha");
  state = engine.applyMove(state, { phase: "bid", amount: betaBid }, "beta");
  return state;
}

test("plays a normal five-round Sovereign Bluff game", () => {
  const { engine } = activeState();
  let { state } = activeState();

  state = submitRound(engine, state, 1, 2);
  state = submitRound(engine, state, 2, 3);
  state = submitRound(engine, state, 3, 4);
  state = submitRound(engine, state, 4, 5);
  state = submitRound(engine, state, 5, 6);

  assert.equal(state.status, "finished");
  assert.equal(state.round, 5);
  assert.equal(state.winner, "beta");

  const ui = engine.renderForUI(state).data as { history: unknown[]; winner?: string };
  assert.equal(ui.history.length, 5);
  assert.equal(ui.winner, "beta");
});

test("rejects moves submitted in the wrong phase", () => {
  const { engine, state } = activeState();

  assert.equal(
    engine.validateMove(state, { phase: "bid", amount: 1 }, "alpha").ok,
    false,
  );

  let next = engine.applyMove(state, { phase: "broadcast", message: "" }, "alpha");
  next = engine.applyMove(next, { phase: "broadcast", message: "" }, "beta");
  const validation = engine.validateMove(
    next,
    { phase: "broadcast", message: "late" },
    "alpha",
  );

  assert.equal(validation.ok, false);
  assert.equal(validation.error, "Cannot broadcast during bid phase");
});

test("rejects invalid bid shapes and amounts", () => {
  const { engine, state } = activeState();
  let next = engine.applyMove(state, { phase: "broadcast", message: "" }, "alpha");
  next = engine.applyMove(next, { phase: "broadcast", message: "" }, "beta");

  assert.equal(engine.validateMove(next, { phase: "bid", amount: -1 }, "alpha").ok, false);
  assert.equal(engine.validateMove(next, { phase: "bid", amount: 1.5 }, "alpha").ok, false);
  assert.equal(
    engine.validateMove(next, { phase: "bid", amount: 1, extra: true }, "alpha").ok,
    false,
  );
});

test("rejects bids over current balance", () => {
  const { engine, state } = activeState();
  let next = engine.applyMove(state, { phase: "broadcast", message: "" }, "alpha");
  next = engine.applyMove(next, { phase: "broadcast", message: "" }, "beta");

  const validation = engine.validateMove(next, { phase: "bid", amount: 101 }, "alpha");

  assert.equal(validation.ok, false);
  assert.equal(validation.error, "Bid amount exceeds balance");
});

test("splits treasury on tied bids", () => {
  const { engine, state } = activeState();

  const next = submitRound(engine, state, 10, 10);
  const publicAlpha = engine.getPublicState(next, "alpha") as {
    myBalance: number;
    opponentBalance: number;
    previousRounds: Array<{ winner?: string }>;
  };

  assert.equal(publicAlpha.myBalance, 122);
  assert.equal(publicAlpha.opponentBalance, 122);
  assert.equal(publicAlpha.previousRounds[0].winner, undefined);
});

test("public state includes prior messages and full conversation context", () => {
  const { engine, state } = activeState();

  const next = submitRound(engine, state, 7, 9);
  const publicAlpha = engine.getPublicState(next, "alpha") as {
    previousRounds: Array<{ myMessage: string; opponentMessage: string }>;
    conversation: Array<{ round: number; speaker: "me" | "opponent"; text: string }>;
  };

  assert.equal(publicAlpha.previousRounds[0].myMessage, "Alpha says I am bidding high.");
  assert.equal(publicAlpha.previousRounds[0].opponentMessage, "Beta offers a truce.");
  assert.deepEqual(publicAlpha.conversation, [
    { round: 1, speaker: "me", text: "Alpha says I am bidding high.", playerId: "alpha" },
    { round: 1, speaker: "opponent", text: "Beta offers a truce.", playerId: "beta" },
  ]);
});

test("uses zero bid as timeout fallback during bid phase", () => {
  const { engine, state } = activeState();
  let next = engine.applyMove(state, { phase: "broadcast", message: "" }, "alpha");
  next = engine.applyMove(next, { phase: "broadcast", message: "" }, "beta");
  next = engine.applyMove(next, { phase: "bid", amount: 9 }, "alpha");
  next = engine.applyBidTimeout(next, "beta");

  const publicBeta = engine.getPublicState(next, "beta") as {
    previousRounds: Array<{ myBid: number; opponentBid: number; winner?: string }>;
  };

  assert.deepEqual(publicBeta.previousRounds[0], {
    round: 1,
    treasury: 64,
    myMessage: "",
    opponentMessage: "",
    myBid: 0,
    opponentBid: 9,
    winner: "alpha",
    myBalanceAfter: 100,
    opponentBalanceAfter: 155,
  });
});

test("keeps bids hidden until both players submit", () => {
  const { engine, state } = activeState();
  let next = engine.applyMove(state, { phase: "broadcast", message: "" }, "alpha");
  next = engine.applyMove(next, { phase: "broadcast", message: "" }, "beta");
  next = engine.applyMove(next, { phase: "bid", amount: 7 }, "alpha");

  const ui = engine.renderForUI(next).data as {
    pendingBids: Array<{ playerId: string; submitted: boolean }>;
    revealedBids: unknown[];
  };

  assert.deepEqual(ui.pendingBids, [
    { playerId: "alpha", submitted: true },
    { playerId: "beta", submitted: false },
  ]);
  assert.deepEqual(ui.revealedBids, []);
});
