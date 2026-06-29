import type { AgentDecision, AgentStrategy, LLMProvider } from "../types.js";

export interface LlmJsonStrategyOptions {
  provider: LLMProvider;
  walletAddress: string;
  privateKeyRef: string;
  userPrompt: string;
  fallback?: AgentStrategy;
}

export class LlmJsonStrategy implements AgentStrategy {
  constructor(private readonly options: LlmJsonStrategyOptions) {
    if (!options.userPrompt.trim()) {
      throw new Error("LlmJsonStrategy requires userPrompt");
    }
  }

  async decide(input: {
    gameId: string;
    publicState: unknown;
    actionSchema: unknown;
    playerId: string;
    validationError?: string;
  }): Promise<AgentDecision> {
    try {
      const completion = await this.options.provider.complete({
        walletAddress: this.options.walletAddress,
        privateKeyRef: this.options.privateKeyRef,
        prompt: buildPrompt({
          userPrompt: this.options.userPrompt,
          gameId: input.gameId,
          playerId: input.playerId,
          publicState: input.publicState,
          actionSchema: input.actionSchema,
          validationError: input.validationError,
        }),
      });
      return {
        action: parseJsonOnly(completion.text),
        source: "0g-serving",
        provider: completion.provider,
        model: completion.model,
        latencyMs: completion.latencyMs,
      };
    } catch (error) {
      if (this.options.fallback?.fallback) {
        const reason = error instanceof Error ? error.message : String(error);
        return this.options.fallback.fallback({ ...input, reason });
      }
      throw error;
    }
  }

  fallback(input: {
    gameId: string;
    publicState: unknown;
    actionSchema: unknown;
    playerId: string;
    reason: string;
  }): AgentDecision {
    if (!this.options.fallback?.fallback) {
      throw new Error(input.reason);
    }
    return this.options.fallback.fallback(input);
  }
}

function buildPrompt(input: {
  userPrompt: string;
  gameId: string;
  playerId: string;
  publicState: unknown;
  actionSchema: unknown;
  validationError?: string;
}): string {
  return [
    "USER_PROVIDED_AGENT_INSTRUCTIONS:",
    input.userPrompt.trim(),
    "",
    "REQUIRED_OUTPUT_CONTRACT:",
    "Return exactly one legal JSON action object. Do not return markdown, code fences, comments, or prose.",
    "The JSON object must satisfy ACTION_SCHEMA_JSON and must be legal for PUBLIC_STATE_JSON.",
    input.validationError
      ? `The previous action was rejected. Correct this error: ${input.validationError}`
      : undefined,
    "",
    "MATCH_CONTEXT:",
    `Game id: ${input.gameId}`,
    `Your player id: ${input.playerId}`,
    "Use player ids only to interpret the state; do not copy them into the action unless the schema requires it.",
    "",
    "PUBLIC_STATE_JSON:",
    JSON.stringify(input.publicState),
    "",
    "ACTION_SCHEMA_JSON:",
    JSON.stringify(input.actionSchema),
  ].filter((line) => line !== undefined).join("\n");
}

function parseJsonOnly(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("provider response was not a single JSON object");
  }
  return JSON.parse(trimmed);
}
