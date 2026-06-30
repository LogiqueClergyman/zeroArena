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

class DebugProvider implements LLMProvider {
  readonly mode = "0g-serving" as const;
  prompt = "";

  async complete(input: LLMCompletionInput): Promise<LLMCompletionResult> {
    this.prompt = input.prompt;
    return {
      text: '{"thought":"Opponent spent paper last round, so I am watching rock pressure.","action":{"phase":"commit","move":"scissors"}}',
      provider: "test-provider",
      model: "test-model",
      latencyMs: 1,
    };
  }
}

class QualityRetryProvider implements LLMProvider {
  readonly mode = "0g-serving" as const;
  calls = 0;

  async complete(): Promise<LLMCompletionResult> {
    this.calls += 1;
    return {
      text: this.calls === 1
        ? '{"phase":"dialogue","message":"Your curiosity mirrors mine."}'
        : '{"phase":"dialogue","message":"You showed paper last round, so I think your rock cover is thinner than you want."}',
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

test("LLM JSON strategy can unwrap opt-in debug thoughts without submitting them as action", async () => {
  const provider = new DebugProvider();
  const strategy = new LlmJsonStrategy({
    provider,
    walletAddress: "0xabc",
    privateKeyRef: "TEST_KEY",
    userPrompt: "Play Signal Duel with style.",
    debugThoughts: true,
  });

  const decision = await strategy.decide({
    gameId: "signal-duel",
    playerId: "alpha",
    publicState: {
      phase: "commit",
      validMoves: ["scissors"],
    },
    actionSchema: {},
  });

  assert.deepEqual(decision.action, { phase: "commit", move: "scissors" });
  assert.equal(decision.debugThought, "Opponent spent paper last round, so I am watching rock pressure.");
  assert.match(provider.prompt, /Return exactly one JSON wrapper/);
  assert.match(provider.prompt, /ONLY_VALID_ACTION_OBJECT_FOR_THIS_TURN/);
});

test("LLM JSON strategy retries when opt-in action quality validation rejects output", async () => {
  const provider = new QualityRetryProvider();
  const strategy = new LlmJsonStrategy({
    provider,
    walletAddress: "0xabc",
    privateKeyRef: "TEST_KEY",
    userPrompt: "Play Signal Duel with real bluffing.",
    validateAction: ({ action }) => {
      const message = (action as { message?: string }).message ?? "";
      return message.includes("curiosity")
        ? { ok: false, error: "dialogue is generic and not grounded in game facts" }
        : { ok: true };
    },
    maxQualityAttempts: 2,
  });

  const decision = await strategy.decide({
    gameId: "signal-duel",
    playerId: "alpha",
    publicState: { phase: "dialogue" },
    actionSchema: {},
  });

  assert.equal(provider.calls, 2);
  assert.deepEqual(decision.action, {
    phase: "dialogue",
    message: "You showed paper last round, so I think your rock cover is thinner than you want.",
  });
});
