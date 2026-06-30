import test from "node:test";
import assert from "node:assert/strict";
import { SignalDuel, type SignalDuelBoard, type SignalDuelMove } from "../src/index.js";

const players = ["alpha", "beta"] as const;

function activeGame(extraTokens: Record<string, SignalDuelMove> = { alpha: "rock", beta: "paper" }) {
  const game = new SignalDuel({ extraTokens });
  const state = game.initState([...players]);
  state.status = "active";
  return { game, state };
}

function board(state: { board: unknown }) {
  return state.board as SignalDuelBoard;
}

function dialogueRound(game: SignalDuel, state: ReturnType<typeof activeGame>["state"]) {
  let next = state;
  const order = [...board(next).dialogueOrder];
  next = game.applyMove(next, { phase: "dialogue", message: "first" }, order[0]);
  next = game.applyMove(next, { phase: "dialogue", message: "reply" }, order[1]);
  next = game.applyMove(next, { phase: "dialogue", message: "second" }, order[2]);
  next = game.applyMove(next, { phase: "dialogue", message: "close" }, order[3]);
  return next;
}

function playRound(
  game: SignalDuel,
  state: ReturnType<typeof activeGame>["state"],
  starterMove: SignalDuelMove,
  responderMove: SignalDuelMove,
) {
  let next = dialogueRound(game, state);
  const starter = board(next).starter;
  const responder = next.players.find((player) => player !== starter)!;
  next = game.applyMove(next, { phase: "commit", move: starterMove }, starter);
  next = game.applyMove(next, { phase: "commit", move: responderMove }, responder);
  return next;
}

test("initializes two players and inventories with one extra token each", () => {
  const { state } = activeGame({ alpha: "rock", beta: "scissors" });
  assert.equal(state.currentPlayer, "alpha");
  assert.deepEqual(board(state).inventories.alpha, { rock: 2, paper: 1, scissors: 1 });
  assert.deepEqual(board(state).inventories.beta, { rock: 1, paper: 1, scissors: 2 });
  assert.deepEqual(board(state).extraTokens, { alpha: "rock", beta: "scissors" });
});

test("dialogue order is starter, responder, starter, responder", () => {
  const { game, state } = activeGame();
  let next = game.applyMove(state, { phase: "dialogue", message: "a" }, "alpha");
  assert.equal(next.currentPlayer, "beta");
  next = game.applyMove(next, { phase: "dialogue", message: "b" }, "beta");
  assert.equal(next.currentPlayer, "alpha");
  next = game.applyMove(next, { phase: "dialogue", message: "c" }, "alpha");
  assert.equal(next.currentPlayer, "beta");
  next = game.applyMove(next, { phase: "dialogue", message: "d" }, "beta");
  assert.equal(board(next).phase, "commit");
  assert.equal(next.currentPlayer, "alpha");
});

test("commit phase hides first committed move until second commit and reveal", () => {
  const { game, state } = activeGame();
  let next = dialogueRound(game, state);
  next = game.applyMove(next, { phase: "commit", move: "rock" }, "alpha");
  const alphaView = game.getPublicState(next, "alpha") as Record<string, unknown>;
  const betaView = game.getPublicState(next, "beta") as Record<string, unknown>;
  assert.equal(alphaView.hasCommitted, true);
  assert.equal(betaView.opponentCommitted, true);
  assert.equal(JSON.stringify(alphaView).includes('"committedMoves"'), false);
  assert.equal((betaView.roundHistory as unknown[]).length, 0);
  assert.deepEqual(betaView.opponentPlayedMoves, []);
  next = game.applyMove(next, { phase: "commit", move: "scissors" }, "beta");
  assert.equal(board(next).roundHistory[0].moves.alpha, "rock");
  assert.equal(board(next).roundHistory[0].moves.beta, "scissors");
});

test("invalid phase and out-of-turn actions are rejected", () => {
  const { game, state } = activeGame();
  assert.deepEqual(game.validateMove(state, { phase: "commit", move: "rock" }, "alpha"), {
    ok: false,
    error: "Cannot commit during dialogue phase",
  });
  assert.deepEqual(game.validateMove(state, { phase: "dialogue", message: "late" }, "beta"), {
    ok: false,
    error: "It is not this player's turn",
  });
  const commitState = dialogueRound(game, state);
  assert.deepEqual(game.validateMove(commitState, { phase: "dialogue", message: "late" }, "alpha"), {
    ok: false,
    error: "Cannot submit dialogue during commit phase",
  });
});

test("dialogue validation rejects empty and oversized messages", () => {
  const { game, state } = activeGame();
  assert.equal(game.validateMove(state, { phase: "dialogue", message: "" }, "alpha").ok, false);
  assert.equal(game.validateMove(state, { phase: "dialogue", message: "x".repeat(201) }, "alpha").ok, false);
});

test("cannot commit a move with zero inventory", () => {
  const { game, state } = activeGame({ alpha: "rock", beta: "rock" });
  let next = playRound(game, state, "paper", "rock");
  next = playRound(game, next, "paper", "rock");
  next = dialogueRound(game, next);
  assert.deepEqual(game.validateMove(next, { phase: "commit", move: "paper" }, board(next).starter), {
    ok: false,
    error: "Move is not available in inventory",
  });
});

test("scoring rock paper scissors works and loser starts next round", () => {
  const { game, state } = activeGame();
  const next = playRound(game, state, "rock", "scissors");
  assert.equal(board(next).scores.alpha, 1);
  assert.equal(board(next).scores.beta, 0);
  assert.equal(board(next).roundHistory[0].winner, "alpha");
  assert.equal(board(next).starter, "beta");
});

test("tie alternates starter", () => {
  const { game, state } = activeGame();
  const next = playRound(game, state, "rock", "rock");
  assert.equal(board(next).roundHistory[0].result, "tie");
  assert.equal(board(next).starter, "beta");
});

test("final unequal score returns winner", () => {
  const { game, state } = activeGame({ alpha: "rock", beta: "scissors" });
  let next = playRound(game, state, "rock", "scissors");
  next = playRound(game, next, "scissors", "rock");
  next = playRound(game, next, "paper", "scissors");
  assert.equal(next.status, "finished");
  assert.equal(game.checkTermination(next).outcome, "winner");
  assert.equal(next.winner, "alpha");
});

test("final tied score returns draw", () => {
  const { game, state } = activeGame({ alpha: "rock", beta: "rock" });
  let next = playRound(game, state, "rock", "rock");
  next = playRound(game, next, "paper", "paper");
  next = playRound(game, next, "scissors", "scissors");
  const termination = game.checkTermination(next);
  assert.equal(next.status, "finished");
  assert.equal(termination.outcome, "draw");
  assert.equal(next.winner, undefined);
  assert.equal(next.publicContext, "draw");
});

test("public state hides opponent private inventory and committed move", () => {
  const { game, state } = activeGame({ alpha: "scissors", beta: "paper" });
  const initial = game.getPublicState(state, "alpha") as Record<string, unknown>;
  assert.deepEqual(initial.myInventory, { rock: 1, paper: 1, scissors: 2 });
  assert.equal("opponentInventory" in initial, false);
  assert.equal("extraTokens" in initial, false);

  let next = dialogueRound(game, state);
  next = game.applyMove(next, { phase: "commit", move: "scissors" }, "alpha");
  const betaView = game.getPublicState(next, "beta");
  assert.equal(JSON.stringify(betaView).includes("committedMoves"), false);
  assert.equal(JSON.stringify(betaView).includes("opponentPossibleRemainingMoves"), false);
});

test("default moves are legal for dialogue and commit", () => {
  const { game, state } = activeGame();
  const dialogueDefault = game.getDefaultMove(state, "alpha");
  assert.equal(game.validateMove(state, dialogueDefault, "alpha").ok, true);
  const commitState = dialogueRound(game, state);
  const commitDefault = game.getDefaultMove(commitState, "alpha");
  assert.equal(game.validateMove(commitState, commitDefault, "alpha").ok, true);
});
