import type { ValidateFunction } from "ajv";
import type { LLMProvider } from "./providers/LLMProvider.js";
import { MockProvider } from "./providers/MockProvider.js";

export interface AgentStrategy {
  readonly playerId: string;
  readonly name: string;
  readonly walletAddress: string;
  readonly privateKeyRef: string;
  decide(input: {
    gameId: string;
    publicState: unknown;
    actionSchema: unknown;
    playerId: string;
  }): Promise<AgentDecision>;
}

export interface AgentDecision {
  action: unknown;
  log: AgentTurnLog;
}

export interface AgentTurnLog {
  playerId: string;
  walletAddress: string;
  inferenceMode: "0g-serving" | "mock fallback";
  provider: string;
  model: string;
  latencyMs: number;
  validationResult: { ok: boolean; error?: string };
  fallbackReason?: string;
}

export interface DemoAgentOptions {
  playerId: string;
  name: string;
  walletAddress: string;
  privateKeyRef: string;
  persona: string;
  provider: LLMProvider;
  validatorForSchema: (schema: unknown) => ValidateFunction;
}

class DemoAgent implements AgentStrategy {
  private readonly fallback = new MockProvider();

  constructor(private readonly options: DemoAgentOptions) {}

  get playerId(): string {
    return this.options.playerId;
  }

  get name(): string {
    return this.options.name;
  }

  get walletAddress(): string {
    return this.options.walletAddress;
  }

  get privateKeyRef(): string {
    return this.options.privateKeyRef;
  }

  async decide(input: {
    gameId: string;
    publicState: unknown;
    actionSchema: unknown;
    playerId: string;
  }): Promise<AgentDecision> {
    const prompt = this.buildPrompt(input);
    const validate = this.options.validatorForSchema(input.actionSchema);
    let lastReason: string | undefined;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const completion = await this.options.provider.complete({
          prompt,
          walletAddress: this.options.walletAddress,
          privateKeyRef: this.options.privateKeyRef,
        });
        const action = parseJsonOnly(completion.text);
        if (validate(action)) {
          return {
            action,
            log: {
              playerId: this.options.playerId,
              walletAddress: this.options.walletAddress,
              inferenceMode:
                this.options.provider.mode === "0g-serving" ? "0g-serving" : "mock fallback",
              provider: completion.provider,
              model: completion.model,
              latencyMs: completion.latencyMs,
              validationResult: { ok: true },
            },
          };
        }
        lastReason = `0G output failed schema validation on attempt ${attempt}: ${formatAjvError(validate.errors)}`;
      } catch (error) {
        lastReason = `0G inference failed on attempt ${attempt}: ${errorMessage(error)}`;
      }
    }

    const fallback = await this.fallback.complete({
      prompt,
      walletAddress: this.options.walletAddress,
      privateKeyRef: this.options.privateKeyRef,
    });
    const action = parseJsonOnly(fallback.text);
    const ok = validate(action);
    return {
      action,
      log: {
        playerId: this.options.playerId,
        walletAddress: this.options.walletAddress,
        inferenceMode: "mock fallback",
        provider: fallback.provider,
        model: fallback.model,
        latencyMs: fallback.latencyMs,
        validationResult: ok
          ? { ok: true }
          : { ok: false, error: formatAjvError(validate.errors) },
        fallbackReason: lastReason ?? "0G provider unavailable",
      },
    };
  }

  private buildPrompt(input: {
    gameId: string;
    publicState: unknown;
    actionSchema: unknown;
    playerId: string;
  }): string {
    return [
      `AGENT: ${this.options.name}`,
      `PERSONA: ${this.options.persona}`,
      `PLAYER_ID: ${input.playerId}`,
      "You are playing Sovereign Bluff. Choose exactly one legal action for the current phase.",
      "For broadcast, return {\"phase\":\"broadcast\",\"message\":\"...\"}.",
      "For bid, return {\"phase\":\"bid\",\"amount\":integer}. Never bid more than myBalance.",
      `PUBLIC_STATE:${JSON.stringify(input.publicState)}`,
      `ACTION_SCHEMA:${JSON.stringify(input.actionSchema)}`,
    ].join("\n");
  }
}

export function createCautiousAgent(options: Omit<DemoAgentOptions, "persona" | "name">): AgentStrategy {
  return new DemoAgent({
    ...options,
    name: "CautiousAgent",
    persona:
      "CautiousAgent is polite, conservative, preserves balance, and usually bids 20-35 percent of the treasury.",
  });
}

export function createAggressiveAgent(
  options: Omit<DemoAgentOptions, "persona" | "name">,
): AgentStrategy {
  return new DemoAgent({
    ...options,
    name: "AggressiveAgent",
    persona:
      "AggressiveAgent is bold, pressures early rounds, bids 45-70 percent of treasury, and backs off when low on balance.",
  });
}

function parseJsonOnly(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("response was not a single JSON object");
  }
  return JSON.parse(trimmed);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatAjvError(errors: ValidateFunction["errors"]): string {
  return errors?.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ") ?? "";
}
