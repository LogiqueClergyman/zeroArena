import assert from "node:assert/strict";
import { test } from "node:test";
import type { GameState } from "@zeroarena/game-sdk";
import { Connect4, type Connect4Board } from "../src/index.js";

const engine = new Connect4();
const players = ["alpha", "beta"];

function activeState(): GameState {
  const state = engine.initState(players);
  state.status = "active";
  return state;
}

function move(state: GameState, player: string, column: number): GameState {
  return engine.applyMove(state, { column }, player);
}

function boardOf(state: GameState): Connect4Board {
  return state.board as Connect4Board;
}

test("Connect4 detects a horizontal win", () => {
  let state = activeState();

  state = move(state, "alpha", 0);
  state = move(state, "beta", 0);
  state = move(state, "alpha", 1);
  state = move(state, "beta", 1);
  state = move(state, "alpha", 2);
  state = move(state, "beta", 2);
  state = move(state, "alpha", 3);

  assert.equal(state.status, "finished");
  assert.equal(engine.checkTermination(state).winner, "alpha");
  assert.equal(boardOf(state).winningCells.length, 4);
});

test("Connect4 detects a vertical win", () => {
  let state = activeState();

  state = move(state, "alpha", 0);
  state = move(state, "beta", 1);
  state = move(state, "alpha", 0);
  state = move(state, "beta", 1);
  state = move(state, "alpha", 0);
  state = move(state, "beta", 1);
  state = move(state, "alpha", 0);

  assert.equal(state.status, "finished");
  assert.equal(engine.checkTermination(state).winner, "alpha");
});

test("Connect4 detects a down-right diagonal win", () => {
  const state = diagonalFixture([
    [5, 0],
    [4, 1],
    [3, 2],
  ]);

  const finished = move(state, "alpha", 3);

  assert.equal(finished.status, "finished");
  assert.equal(finished.winner, "alpha");
  assert.deepEqual(boardOf(finished).winningCells, [
    { row: 2, column: 3 },
    { row: 3, column: 2 },
    { row: 4, column: 1 },
    { row: 5, column: 0 },
  ]);
});

test("Connect4 detects a down-left diagonal win", () => {
  const state = diagonalFixture([
    [5, 6],
    [4, 5],
    [3, 4],
  ]);

  const finished = move(state, "alpha", 3);

  assert.equal(finished.status, "finished");
  assert.equal(finished.winner, "alpha");
  assert.deepEqual(boardOf(finished).winningCells, [
    { row: 2, column: 3 },
    { row: 3, column: 4 },
    { row: 4, column: 5 },
    { row: 5, column: 6 },
  ]);
});

test("Connect4 rejects a full column", () => {
  let state = activeState();
  for (let index = 0; index < 6; index += 1) {
    state = move(state, index % 2 === 0 ? "alpha" : "beta", 0);
  }

  assert.deepEqual(engine.validateMove(state, { column: 0 }, "alpha"), {
    ok: false,
    error: "Column is full",
  });
});

test("Connect4 enforces alternating turns", () => {
  let state = activeState();
  state = move(state, "alpha", 0);

  assert.equal(boardOf(state).currentPlayer, "beta");
  assert.deepEqual(engine.validateMove(state, { column: 1 }, "alpha"), {
    ok: false,
    error: "It is not this player's turn",
  });
});

test("Connect4 reports a draw on a full board without deterministic winner", () => {
  const state = nearDrawFixture();
  const finished = move(state, "alpha", 6);
  const termination = engine.checkTermination(finished);

  assert.equal(finished.status, "finished");
  assert.equal(finished.winner, undefined);
  assert.equal(termination.outcome, "draw");
  assert.equal(finished.publicContext, "draw");
});

test("Connect4 exposes a public state and UI payload for rendering", () => {
  let state = activeState();
  state = move(state, "alpha", 3);

  const publicState = engine.getPublicState(state, "beta") as Record<string, unknown>;
  const ui = engine.renderForUI(state);

  assert.equal(publicState.game, "connect4");
  assert.deepEqual(publicState.validColumns, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(publicState.currentPlayer, "beta");
  assert.equal(ui.kind, "connect4");
  assert.equal((ui.data as Record<string, unknown>).lastMove !== undefined, true);
});

function diagonalFixture(alphaCells: Array<[number, number]>): GameState {
  const state = activeState();
  const board = boardOf(state);
  for (const [row, column] of alphaCells) {
    board.grid[row][column] = "alpha";
  }
  board.grid[5][3] = "beta";
  board.grid[4][3] = "beta";
  board.grid[3][3] = "beta";
  board.currentPlayer = "alpha";
  state.currentPlayer = "alpha";
  return state;
}

function nearDrawFixture(): GameState {
  const state = activeState();
  const board = boardOf(state);
  const rows = [
    "aabbaa.",
    "bbaabba",
    "aabbaab",
    "bbaabba",
    "aabbaab",
    "bbaabba",
  ];
  board.grid = rows.map((row) =>
    [...row].map((cell) => (cell === "a" ? "alpha" : cell === "b" ? "beta" : null)),
  );
  board.currentPlayer = "alpha";
  state.currentPlayer = "alpha";
  return state;
}
