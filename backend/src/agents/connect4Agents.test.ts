import assert from "node:assert/strict";
import { test } from "node:test";
import AjvImport, { type ValidateFunction } from "ajv";
import { createConnect4Agent } from "./connect4Agents.js";
import type {
  LLMCompletionInput,
  LLMCompletionResult,
  LLMProvider,
} from "./providers/LLMProvider.js";
import { connect4ActionSchema } from "../games/Connect4.js";

const ajv = new (AjvImport as unknown as new (options: {
  allErrors: boolean;
  strict: boolean;
}) => { compile(schema: unknown): ValidateFunction })({ allErrors: true, strict: false });

test("Connect4 agent rejects a model move into a full column and falls back to a legal column", async () => {
  const agent = createConnect4Agent({
    playerId: "alpha",
    name: "Alpha",
    walletAddress: "0xalpha",
    privateKeyRef: "AGENT_ALPHA_PRIVATE_KEY",
    provider: new AlwaysColumnProvider(2),
    allowMockFallback: true,
    validatorForSchema: (schema) => ajv.compile(schema),
  });

  const decision = await agent.decide({
    gameId: "connect4",
    playerId: "alpha",
    actionSchema: connect4ActionSchema,
    publicState: {
      game: "connect4",
      rows: 6,
      columns: 7,
      players: ["alpha", "beta"],
      currentPlayer: "alpha",
      currentPiece: "red",
      validColumns: [0, 1, 3, 4, 5, 6],
      board: [
        [null, null, "beta", null, null, null, null],
        [null, null, "alpha", null, null, null, null],
        [null, null, "beta", null, null, null, null],
        [null, null, "alpha", null, null, null, null],
        [null, null, "beta", null, null, null, null],
        ["alpha", "beta", "alpha", null, null, null, null],
      ],
      phase: "drop",
      moveCount: 8,
    },
  });

  const action = decision.action as { column: number };
  assert.notEqual(action.column, 2);
  assert.ok([0, 1, 3, 4, 5, 6].includes(action.column));
  assert.equal(decision.log.inferenceMode, "mock fallback");
  assert.match(decision.log.fallbackReason ?? "", /not currently legal/);
});

test("Connect4 fallback blocks an immediate vertical win", async () => {
  const agent = createConnect4Agent({
    playerId: "alpha",
    name: "Alpha",
    walletAddress: "0xalpha",
    privateKeyRef: "AGENT_ALPHA_PRIVATE_KEY",
    provider: new AlwaysColumnProvider(99),
    allowMockFallback: true,
    validatorForSchema: (schema) => ajv.compile(schema),
  });

  const decision = await agent.decide({
    gameId: "connect4",
    playerId: "alpha",
    actionSchema: connect4ActionSchema,
    publicState: {
      game: "connect4",
      rows: 6,
      columns: 7,
      players: ["alpha", "beta"],
      currentPlayer: "alpha",
      currentPiece: "red",
      validColumns: [0, 1, 2, 3, 4, 5, 6],
      board: [
        [null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null],
        [null, "beta", null, null, null, null, null],
        [null, "beta", null, null, null, null, null],
        ["alpha", "beta", "alpha", null, null, null, null],
      ],
      phase: "drop",
      moveCount: 5,
    },
  });

  assert.deepEqual(decision.action, { column: 1 });
});

class AlwaysColumnProvider implements LLMProvider {
  readonly mode = "mock" as const;

  constructor(private readonly column: number) {}

  async complete(_input: LLMCompletionInput): Promise<LLMCompletionResult> {
    return {
      text: JSON.stringify({ column: this.column }),
      provider: "always-column",
      model: "regression",
      latencyMs: 0,
    };
  }
}
