import assert from "node:assert/strict";
import { test } from "node:test";
import { LlmJsonStrategy } from "./llmJsonStrategy.js";
import type { LLMCompletionInput, LLMCompletionResult, LLMProvider } from "../types.js";

class CapturingProvider implements LLMProvider {
  readonly mode = "0g-serving" as const;
  prompt = "";

  async complete(input: LLMCompletionInput): Promise<LLMCompletionResult> {
    this.prompt = input.prompt;
    return {
      text: '{"phase":"dialogue","message":"The clean read is already compromised."}',
      provider: "test-provider",
      model: "test-model",
      latencyMs: 1,
    };
  }
}

test("LLM JSON prompt hard-locks Signal Duel dialogue phase", async () => {
  const provider = new CapturingProvider();
  const strategy = new LlmJsonStrategy({
    provider,
    walletAddress: "0xabc",
    privateKeyRef: "TEST_KEY",
    userPrompt: "Play Signal Duel with style.",
  });

  await strategy.decide({
    gameId: "signal-duel",
    playerId: "alpha",
    publicState: {
      phase: "dialogue",
      validMoves: ["rock", "paper", "scissors"],
    },
    actionSchema: {},
  });

  assert.match(provider.prompt, /CURRENT_PHASE: dialogue/);
  assert.match(provider.prompt, /action\.phase must be exactly "dialogue"/);
  assert.match(provider.prompt, /ONLY_VALID_JSON_FOR_THIS_TURN: \{"phase":"dialogue"/);
  assert.match(provider.prompt, /Do not return \{"phase":"commit"/);
});

test("LLM JSON prompt hard-locks Signal Duel commit phase to valid moves", async () => {
  const provider = new CapturingProvider();
  const strategy = new LlmJsonStrategy({
    provider,
    walletAddress: "0xabc",
    privateKeyRef: "TEST_KEY",
    userPrompt: "Play Signal Duel with style.",
  });

  await strategy.decide({
    gameId: "signal-duel",
    playerId: "alpha",
    publicState: {
      phase: "commit",
      validMoves: ["paper"],
    },
    actionSchema: {},
  });

  assert.match(provider.prompt, /CURRENT_PHASE: commit/);
  assert.match(provider.prompt, /action\.phase must be exactly "commit"/);
  assert.match(provider.prompt, /VALID_MOVES_THIS_TURN: \["paper"\]/);
  assert.match(provider.prompt, /Do not return \{"phase":"dialogue"/);
});
