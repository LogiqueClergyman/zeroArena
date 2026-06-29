import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseMove } from "./connect4Basic.js";

test("Connect4 basic strategy takes an immediate win", () => {
  const action = chooseMove({
    board: [
      [null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null],
      ["alpha", "alpha", "alpha", null, "beta", "beta", null],
    ],
    validColumns: [0, 1, 2, 3, 4, 5, 6],
    players: ["alpha", "beta"],
  }, "alpha");

  assert.deepEqual(action, { column: 3 });
});

test("Connect4 basic strategy does not blindly stack center when no tactic exists", () => {
  const action = chooseMove({
    board: [
      [null, null, null, null, null, null, null],
      [null, null, null, "beta", null, null, null],
      [null, null, null, "alpha", null, null, null],
      [null, null, null, "beta", null, null, null],
      [null, null, null, "alpha", null, null, null],
      [null, null, null, "beta", null, null, null],
    ],
    validColumns: [0, 1, 2, 3, 4, 5, 6],
    players: ["alpha", "beta"],
  }, "alpha");

  assert.notEqual(action.column, 3);
});
