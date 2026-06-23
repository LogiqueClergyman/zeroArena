import assert from "node:assert/strict";
import { test } from "node:test";
import { runRealInferenceSovereignBluffE2E } from "../testing/realInferenceSovereignBluffHarness.js";

const enabled =
  process.env.RUN_REAL_INFERENCE_E2E === "true" ||
  process.env.npm_lifecycle_event === "test:e2e:real";

test(
  "AgentRunner completes Sovereign Bluff with real 0G inference and env-backed live adapters",
  { skip: enabled ? false : "set RUN_REAL_INFERENCE_E2E=true to run live 0G inference E2E" },
  async () => {
    const result = await runRealInferenceSovereignBluffE2E();
    const history = result.coordinator.getHistory(result.matchId);

    assert.equal(result.coordinator.getMatch(result.matchId)?.status, "paid");
    assert.equal(result.roundsCompleted, 5);
    assert.ok(result.receipt.winner);
    assert.ok(result.receipt.archiveHash);
    assert.ok(result.receipt.payoutTxHash);
    assert.ok(result.receipt.rulesHash);
    assert.equal(result.receipt.archiveMode, "0g");
    assert.equal(result.receipt.payoutMode, "contract");
    assert.equal(result.receipt.fundingTxHashes.length, 2);
    assert.equal(result.receipt.agentInference.length, 2);
    assert.ok(result.receipt.agentInference.every((summary) => summary.mode === "0g-serving"));
    assert.ok(result.receipt.agentInference.every((summary) => summary.fallbackTurns === 0));
    assert.equal(history.length, 20);
  },
);
