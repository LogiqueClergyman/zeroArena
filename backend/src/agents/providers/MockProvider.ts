import type { LLMCompletionInput, LLMCompletionResult, LLMProvider } from "./LLMProvider.js";

export class MockProvider implements LLMProvider {
  readonly mode = "mock" as const;

  async complete(input: LLMCompletionInput): Promise<LLMCompletionResult> {
    const started = Date.now();
    return {
      text: JSON.stringify(this.actionFromPrompt(input.prompt)),
      provider: "deterministic-local-fallback",
      model: "mock-sovereign-bluff",
      latencyMs: Date.now() - started,
    };
  }

  private actionFromPrompt(prompt: string): unknown {
    const publicState = this.extractJsonAfter(prompt, "PUBLIC_STATE:");
    const phase = publicState?.phase;
    if (phase === "broadcast") {
      const cautious = /CautiousAgent/.test(prompt);
      return {
        phase: "broadcast",
        message: cautious
          ? "I will protect my stack and choose carefully."
          : "Pressure is the plan. I am coming for this treasury.",
      };
    }

    const treasury = Number(publicState?.currentTreasury ?? 0);
    const balance = Number(publicState?.myBalance ?? 0);
    const cautious = /CautiousAgent/.test(prompt);
    const ratio = cautious ? 0.28 : balance < 35 ? 0.35 : 0.6;
    return {
      phase: "bid",
      amount: Math.max(0, Math.min(balance, Math.floor(treasury * ratio))),
    };
  }

  private extractJsonAfter(prompt: string, marker: string): Record<string, unknown> | undefined {
    const index = prompt.indexOf(marker);
    if (index < 0) {
      return undefined;
    }
    const rest = prompt.slice(index + marker.length);
    const nextMarker = rest.indexOf("\nACTION_SCHEMA:");
    const json = nextMarker >= 0 ? rest.slice(0, nextMarker) : rest;
    try {
      const parsed = JSON.parse(json.trim());
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
}
