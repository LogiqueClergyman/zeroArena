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
    validationError?: string;
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
  allowMockFallback: boolean;
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
    validationError?: string;
  }): Promise<AgentDecision> {
    const validate = this.options.validatorForSchema(input.actionSchema);
    let lastReason: string | undefined;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const prompt = this.buildPrompt({ ...input, validationError: lastReason ?? input.validationError });
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

    if (!this.options.allowMockFallback) {
      throw new Error(lastReason ?? "0G inference failed and mock fallback is disabled");
    }

    const prompt = this.buildPrompt({ ...input, validationError: lastReason ?? input.validationError });
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
    validationError?: string;
  }): string {
    const phase = publicStatePhase(input.publicState);
    const myBalance = publicStateNumber(input.publicState, "myBalance");
    const currentTreasury = publicStateNumber(input.publicState, "currentTreasury");
    const currentActionSchema = actionSchemaForPhase(phase);
    const strategicBrief = buildStrategicBrief(input.publicState);
    const allowedAction =
      phase === "broadcast"
        ? 'Only return {"phase":"broadcast","message":"..."} for this turn. Do not bid. The message must be a strategic signal, lie, threat, offer, trap, or reaction to prior rounds.'
        : phase === "bid"
          ? `Only return {"phase":"bid","amount":integer} for this turn. The bid amount must be an integer from 0 to ${myBalance ?? "myBalance"} inclusive. Do not broadcast.`
          : "Return only a legal action for the current phase.";
    return [
      `AGENT: ${this.options.name}`,
      `PERSONA: ${this.options.persona}`,
      `PLAYER_ID: ${input.playerId}`,
      "You are playing Sovereign Bluff. Choose exactly one legal action for the current phase.",
      `STRATEGIC_BRIEF: ${strategicBrief}`,
      "Use the full PUBLIC_STATE, especially previousRounds and conversation. Treat the opponent as remembering your earlier messages.",
      "Your broadcast is not decoration and not just a taunt. Pick exactly one tactic: false commitment, peace offer, revenge threat, fake weakness, flattery, trap, apology, bargain, or intimidation.",
      "Make the tactic legible in the message. Example forms: 'I am putting 50 in; chase me if you want ashes.' or 'Take this one cheap, leave me the next vault.'",
      "If you reference history, use it to change the opponent's next bid. Do not say generic phrases like 'last round' unless naming the consequence.",
      "Do not produce isolated generic taunts. Every message should create pressure, invite cooperation, disguise intent, or punish a pattern.",
      "Write like a rival at a high-stakes arena table, not like a status logger.",
      "Do not say you are broadcasting, bidding, maintaining balance, following strategy, or choosing an action.",
      "Do not mention JSON, schemas, phases, balances, or implementation details in the message.",
      "Do not only insult the opponent. Mix deception, negotiation, fear, restraint, and opportunism across the match.",
      "Broadcast messages should be 12-32 words, concrete, and strategically useful.",
      `CURRENT_PHASE: ${phase ?? "unknown"}`,
      myBalance === undefined ? undefined : `MY_BALANCE: ${myBalance}`,
      currentTreasury === undefined ? undefined : `CURRENT_TREASURY: ${currentTreasury}`,
      `ALLOWED_ACTION: ${allowedAction}`,
      phase === "broadcast"
        ? "ONLY_VALID_JSON_FOR_THIS_TURN: {\"phase\":\"broadcast\",\"message\":\"...\"}"
        : undefined,
      phase === "bid" ? "ONLY_VALID_JSON_FOR_THIS_TURN: {\"phase\":\"bid\",\"amount\":integer}" : undefined,
      phase === "bid"
        ? "This is a bid turn. Any JSON with phase=\"broadcast\" is invalid even if it contains a clever message."
        : undefined,
      phase === "broadcast"
        ? "This is a broadcast turn. Any JSON with phase=\"bid\" is invalid even if it contains a good amount."
        : undefined,
      input.validationError
        ? `CORRECTION_REQUIRED: Your previous action was invalid: ${input.validationError}. Return ONLY the valid ${phase ?? "current"} JSON object for CURRENT_PHASE=${phase ?? "unknown"}. If this is a bid, the corrected amount must be <= ${myBalance ?? "myBalance"}.`
        : undefined,
      `PUBLIC_STATE:${JSON.stringify(input.publicState)}`,
      `CURRENT_ACTION_SCHEMA:${JSON.stringify(currentActionSchema ?? input.actionSchema)}`,
    ].filter(Boolean).join("\n");
  }
}

export function createCautiousAgent(options: Omit<DemoAgentOptions, "persona" | "name">): AgentStrategy {
  return new DemoAgent({
    ...options,
    name: "Vesper",
    persona:
      "Vesper is a cold-blooded archivist queen. She wins by contracts, false truces, selective mercy, and quiet punishment. She preserves reserve, usually bids 20-35 percent of the treasury, and uses broadcasts to make the opponent misprice risk.",
  });
}

export function createAggressiveAgent(
  options: Omit<DemoAgentOptions, "persona" | "name">,
): AgentStrategy {
  return new DemoAgent({
    ...options,
    name: "Knox",
    persona:
      "Knox is a reckless neon pit-fighter. He wins by intimidation, fake all-ins, sudden bargains, and emotional pressure. He usually bids 45-70 percent of the treasury, but backs off when low and uses broadcasts to make surrender look cheaper than contesting.",
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

function publicStatePhase(publicState: unknown): string | undefined {
  if (typeof publicState !== "object" || publicState === null || Array.isArray(publicState)) {
    return undefined;
  }
  const phase = (publicState as Record<string, unknown>).phase;
  return typeof phase === "string" ? phase : undefined;
}

function publicStateNumber(publicState: unknown, key: string): number | undefined {
  if (typeof publicState !== "object" || publicState === null || Array.isArray(publicState)) {
    return undefined;
  }
  const value = (publicState as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function buildStrategicBrief(publicState: unknown): string {
  if (typeof publicState !== "object" || publicState === null || Array.isArray(publicState)) {
    return "No readable state. Make a legal, phase-correct action.";
  }
  const state = publicState as Record<string, unknown>;
  const round = Number(state.round ?? 0);
  const totalRounds = Number(state.totalRounds ?? 0);
  const myBalance = Number(state.myBalance ?? 0);
  const opponentBalance = Number(state.opponentBalance ?? 0);
  const treasury = Number(state.currentTreasury ?? 0);
  const previousRounds = Array.isArray(state.previousRounds)
    ? (state.previousRounds as Array<Record<string, unknown>>)
    : [];
  const lastRound = previousRounds.at(-1);
  const score =
    myBalance > opponentBalance
      ? `You lead by ${myBalance - opponentBalance}.`
      : opponentBalance > myBalance
        ? `You trail by ${opponentBalance - myBalance}.`
        : "Balances are tied.";
  const pressure =
    opponentBalance <= 0
      ? "Opponent has no spendable balance; exploit that with offers or humiliation, not empty threats."
      : myBalance <= 0
        ? "You have no spendable balance; use negotiation, misdirection, or a desperate bargain."
        : treasury >= Math.max(myBalance, opponentBalance) * 0.6
          ? "This treasury can swing the match; use the message to distort the opponent's risk calculation."
          : "This treasury is modest; consider baiting overpayment or proposing restraint.";
  const last =
    lastRound && typeof lastRound === "object"
      ? `Previous resolved round: treasury ${lastRound.treasury}, you bid ${lastRound.myBid}, opponent bid ${lastRound.opponentBid}, winner ${String(lastRound.winner ?? "tie")}.`
      : "No resolved rounds yet; establish a false pattern or opening bargain.";
  const stage =
    round >= totalRounds
      ? "Final round: credibility can be spent freely."
      : round > 1
        ? "Mid-match: build on, betray, or invert earlier signals."
        : "Opening round: plant a pattern you can exploit later.";
  return [stage, score, pressure, last].join(" ");
}

function actionSchemaForPhase(phase: string | undefined): unknown {
  if (phase === "broadcast") {
    return {
      type: "object",
      properties: {
        phase: { const: "broadcast" },
        message: { type: "string", maxLength: 280 },
      },
      required: ["phase", "message"],
      additionalProperties: false,
    };
  }
  if (phase === "bid") {
    return {
      type: "object",
      properties: {
        phase: { const: "bid" },
        amount: { type: "number", minimum: 0 },
      },
      required: ["phase", "amount"],
      additionalProperties: false,
    };
  }
  return undefined;
}
