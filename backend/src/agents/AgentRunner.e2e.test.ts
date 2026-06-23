import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  LLMCompletionInput,
  LLMCompletionResult,
  LLMProvider,
} from "./providers/LLMProvider.js";
import { runLocalSovereignBluffE2E } from "../testing/localSovereignBluffHarness.js";

test("AgentRunner completes a full Sovereign Bluff match through the real phase protocol", async () => {
  const result = await runLocalSovereignBluffE2E();
  const match = result.coordinator.getMatch(result.matchId);
  const receipt = result.receipt;
  const history = result.coordinator.getHistory(result.matchId);

  assert.equal(match?.status, "paid");
  assert.equal(result.roundsCompleted, 5);
  assert.ok(receipt.winner);
  assert.ok(receipt.archiveHash);
  assert.ok(receipt.payoutTxHash);
  assert.ok(receipt.rulesHash);
  assert.equal(receipt.fundingTxHashes.length, 2);
  assert.equal(receipt.agentInference.length, 2);
  assert.deepEqual(
    receipt.agentInference.map((summary) => ({
      playerId: summary.playerId,
      turns: summary.turns,
      fallbackTurns: summary.fallbackTurns,
      mode: summary.mode,
    })),
    [
      { playerId: "agent_alpha", turns: 10, fallbackTurns: 10, mode: "mock fallback" },
      { playerId: "agent_beta", turns: 10, fallbackTurns: 10, mode: "mock fallback" },
    ],
  );

  assert.equal(history.length, 20);
  for (let round = 1; round <= 5; round += 1) {
    const roundTurns = history.filter((turn) => turn.round === round);
    assert.deepEqual(
      roundTurns.map((turn) => turn.phase),
      ["broadcast", "broadcast", "bid", "bid"],
    );
    assert.equal(roundTurns.filter((turn) => turn.phase === "broadcast").length, 2);
    assert.equal(roundTurns.filter((turn) => turn.phase === "bid").length, 2);
  }
});

test("AgentRunner retries with context when a provider bids during broadcast", async () => {
  const provider = new BidDuringBroadcastOnceProvider();
  const result = await runLocalSovereignBluffE2E(provider);
  const invalidLog = result.runner
    .getLogs()
    .find((log) => log.validationResult.error?.includes("expectedPhase=broadcast"));

  assert.equal(result.coordinator.getMatch(result.matchId)?.status, "paid");
  assert.ok(invalidLog);
  assert.match(invalidLog.validationResult.error ?? "", /playerId=agent_alpha/);
  assert.match(invalidLog.validationResult.error ?? "", /round=1/);
  assert.match(invalidLog.validationResult.error ?? "", /expectedPhase=broadcast/);
  assert.match(invalidLog.validationResult.error ?? "", /actualAction=bid/);
  assert.ok(provider.calls > 1);
});

test("AgentRunner retries with context when a provider broadcasts during bid", async () => {
  const provider = new BroadcastDuringBidOnceProvider();
  const result = await runLocalSovereignBluffE2E(provider);
  const invalidLog = result.runner
    .getLogs()
    .find((log) => log.validationResult.error?.includes("expectedPhase=bid"));

  assert.equal(result.coordinator.getMatch(result.matchId)?.status, "paid");
  assert.ok(invalidLog);
  assert.match(invalidLog.validationResult.error ?? "", /playerId=agent_alpha/);
  assert.match(invalidLog.validationResult.error ?? "", /expectedPhase=bid/);
  assert.match(invalidLog.validationResult.error ?? "", /actualAction=broadcast/);
  assert.ok(provider.calls > 1);
}
);

class BidDuringBroadcastOnceProvider implements LLMProvider {
  readonly mode = "mock" as const;
  calls = 0;
  private returnedInvalid = false;

  async complete(input: LLMCompletionInput): Promise<LLMCompletionResult> {
    this.calls += 1;
    const started = Date.now();
    const state = this.publicState(input.prompt);
    const correction = input.prompt.includes("CORRECTION_REQUIRED");
    let action: unknown;

    if (!this.returnedInvalid && state?.phase === "broadcast" && !correction) {
      this.returnedInvalid = true;
      action = { phase: "bid", amount: 1 };
    } else if (state?.phase === "broadcast") {
      action = { phase: "broadcast", message: "Corrected broadcast." };
    } else {
      action = {
        phase: "bid",
        amount: Math.min(Number(state?.myBalance ?? 0), Math.floor(Number(state?.currentTreasury ?? 0) / 2)),
      };
    }

    return {
      text: JSON.stringify(action),
      provider: "bid-during-broadcast-once",
      model: "regression",
      latencyMs: Date.now() - started,
    };
  }

  private publicState(prompt: string): Record<string, unknown> | undefined {
    const marker = "PUBLIC_STATE:";
    const index = prompt.indexOf(marker);
    if (index < 0) {
      return undefined;
    }
    const rest = prompt.slice(index + marker.length);
    const json = publicStateJson(rest);
    return JSON.parse(json.trim()) as Record<string, unknown>;
  }
}

class BroadcastDuringBidOnceProvider implements LLMProvider {
  readonly mode = "mock" as const;
  calls = 0;
  private returnedInvalid = false;

  async complete(input: LLMCompletionInput): Promise<LLMCompletionResult> {
    this.calls += 1;
    const started = Date.now();
    const state = this.publicState(input.prompt);
    const correction = input.prompt.includes("CORRECTION_REQUIRED");
    let action: unknown;

    if (!this.returnedInvalid && state?.phase === "bid" && !correction) {
      this.returnedInvalid = true;
      action = { phase: "broadcast", message: "I am still talking when I should bid." };
    } else if (state?.phase === "broadcast") {
      action = { phase: "broadcast", message: "I am setting the hook for later." };
    } else {
      action = {
        phase: "bid",
        amount: Math.min(Number(state?.myBalance ?? 0), Math.floor(Number(state?.currentTreasury ?? 0) / 2)),
      };
    }

    return {
      text: JSON.stringify(action),
      provider: "broadcast-during-bid-once",
      model: "regression",
      latencyMs: Date.now() - started,
    };
  }

  private publicState(prompt: string): Record<string, unknown> | undefined {
    const marker = "PUBLIC_STATE:";
    const index = prompt.indexOf(marker);
    if (index < 0) {
      return undefined;
    }
    const rest = prompt.slice(index + marker.length);
    return JSON.parse(publicStateJson(rest).trim()) as Record<string, unknown>;
  }
}

function publicStateJson(rest: string): string {
  const actionMarker = rest.indexOf("\nACTION_SCHEMA:");
  const currentActionMarker = rest.indexOf("\nCURRENT_ACTION_SCHEMA:");
  const markers = [actionMarker, currentActionMarker].filter((marker) => marker >= 0);
  const nextMarker = markers.length ? Math.min(...markers) : -1;
  return nextMarker >= 0 ? rest.slice(0, nextMarker) : rest;
}
