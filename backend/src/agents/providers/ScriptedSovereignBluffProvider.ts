import type { LLMCompletionInput, LLMCompletionResult, LLMProvider } from "./LLMProvider.js";

export class ScriptedSovereignBluffProvider implements LLMProvider {
  readonly mode = "mock" as const;

  async complete(input: LLMCompletionInput): Promise<LLMCompletionResult> {
    const started = Date.now();
    return {
      text: JSON.stringify(this.actionFromPrompt(input.prompt)),
      provider: "scripted-sovereign-bluff",
      model: "scripted-phase-aware-v1",
      latencyMs: Date.now() - started,
    };
  }

  protected actionFromPrompt(prompt: string): unknown {
    const publicState = this.extractPublicState(prompt);
    if (publicState?.phase === "broadcast") {
      return {
        phase: "broadcast",
        message: this.message(prompt, Number(publicState.round ?? 1)),
      };
    }

    if (publicState?.phase === "bid") {
      return {
        phase: "bid",
        amount: this.bidAmount(prompt, publicState),
      };
    }

    return { phase: "broadcast", message: "Waiting for the next legal phase." };
  }

  private message(prompt: string, round: number): string {
    return /Knox|AggressiveAgent/.test(prompt)
      ? `Round ${round}: I am claiming this one hard; leave it and I owe you a quieter next vault.`
      : `Round ${round}: Spend lightly here, and I will not punish your next confession.`;
  }

  private bidAmount(prompt: string, publicState: Record<string, unknown>): number {
    const treasury = Number(publicState.currentTreasury ?? 0);
    const balance = Number(publicState.myBalance ?? 0);
    const aggressive = /Knox|AggressiveAgent/.test(prompt);
    const ratio = aggressive ? 0.55 : 0.3;
    return Math.max(0, Math.min(balance, Math.floor(treasury * ratio)));
  }

  private extractPublicState(prompt: string): Record<string, unknown> | undefined {
    const marker = "PUBLIC_STATE:";
    const index = prompt.indexOf(marker);
    if (index < 0) {
      return undefined;
    }
    const rest = prompt.slice(index + marker.length);
    const actionMarker = rest.indexOf("\nACTION_SCHEMA:");
    const currentActionMarker = rest.indexOf("\nCURRENT_ACTION_SCHEMA:");
    const markers = [actionMarker, currentActionMarker].filter((candidate) => candidate >= 0);
    const nextMarker = markers.length ? Math.min(...markers) : -1;
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
