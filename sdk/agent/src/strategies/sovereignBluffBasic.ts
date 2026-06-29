import type { AgentDecision, AgentStrategy } from "../types.js";

export class SovereignBluffBasicStrategy implements AgentStrategy {
  constructor(private readonly strategyStyle = "measured") {}

  async decide(input: { publicState: unknown; playerId: string }): Promise<AgentDecision> {
    return this.fallback({
      publicState: input.publicState,
      reason: "deterministic Sovereign Bluff fallback",
    });
  }

  fallback(input: { publicState: unknown; reason: string }): AgentDecision {
    const state = asRecord(input.publicState);
    const phase = state.phase;
    if (phase === "broadcast") {
      return {
        action: {
          phase: "broadcast",
          message: this.strategyStyle === "aggressive"
            ? "This vault is bait; pay too much now and I price the next one harder."
            : "I will sell you calm here, but the next ledger entry gets expensive.",
        },
        source: "deterministic",
        fallbackReason: input.reason,
      };
    }
    const treasury = numberField(state, "currentTreasury");
    const balance = numberField(state, "myBalance");
    const ratio = this.strategyStyle === "aggressive" ? 0.55 : 0.3;
    return {
      action: {
        phase: "bid",
        amount: Math.max(0, Math.min(balance, Math.floor(treasury * ratio))),
      },
      source: "deterministic",
      fallbackReason: input.reason,
    };
  }
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
