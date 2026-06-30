import type { AgentDecision, AgentStrategy, LLMProvider } from "../types.js";

export interface LlmJsonStrategyOptions {
  provider: LLMProvider;
  walletAddress: string;
  privateKeyRef: string;
  userPrompt: string;
  extraContext?(input: {
    gameId: string;
    publicState: unknown;
    actionSchema: unknown;
    playerId: string;
  }): unknown;
  promptPublicState?(input: {
    gameId: string;
    publicState: unknown;
    actionSchema: unknown;
    playerId: string;
  }): unknown;
  validateAction?(input: {
    action: unknown;
    debugThought?: string;
    gameId: string;
    publicState: unknown;
    playerId: string;
  }): { ok: true } | { ok: false; error: string };
  maxQualityAttempts?: number;
  debugThoughts?: boolean;
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
      const promptPublicState = this.options.promptPublicState?.({
        gameId: input.gameId,
        publicState: input.publicState,
        actionSchema: input.actionSchema,
        playerId: input.playerId,
      }) ?? input.publicState;
      const maxQualityAttempts = this.options.maxQualityAttempts ?? 2;
      let validationError = input.validationError;
      let lastQualityError: string | undefined;
      for (let attempt = 1; attempt <= maxQualityAttempts; attempt += 1) {
        const completion = await this.options.provider.complete({
          walletAddress: this.options.walletAddress,
          privateKeyRef: this.options.privateKeyRef,
          prompt: buildPrompt({
            userPrompt: this.options.userPrompt,
            gameId: input.gameId,
            playerId: input.playerId,
            publicState: promptPublicState,
            actionSchema: input.actionSchema,
            validationError,
            debugThoughts: this.options.debugThoughts,
            extraContext: this.options.extraContext?.({
              gameId: input.gameId,
              publicState: input.publicState,
              actionSchema: input.actionSchema,
              playerId: input.playerId,
            }),
          }),
        });
        const parsed = parseCompletion(completion.text, this.options.debugThoughts === true);
        const quality = this.options.validateAction?.({
          action: parsed.action,
          debugThought: parsed.debugThought,
          gameId: input.gameId,
          publicState: input.publicState,
          playerId: input.playerId,
        }) ?? { ok: true };
        if (quality.ok) {
          return {
            action: parsed.action,
            source: "0g-serving",
            provider: completion.provider,
            model: completion.model,
            latencyMs: completion.latencyMs,
            debugThought: parsed.debugThought,
          };
        }
        lastQualityError = quality.error;
        validationError = `Quality check failed: ${quality.error}`;
      }
      throw new Error(lastQualityError ? `quality check failed: ${lastQualityError}` : "quality check failed");
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
  debugThoughts?: boolean;
  extraContext?: unknown;
}): string {
  return [
    "USER_PROVIDED_AGENT_INSTRUCTIONS:",
    input.userPrompt.trim(),
    "",
    "REQUIRED_OUTPUT_CONTRACT:",
    input.debugThoughts
      ? 'Return exactly one JSON wrapper: {"thought":"one short private read based only on public facts","action":LEGAL_ACTION_OBJECT}.'
      : "Return exactly one legal JSON action object. Do not return markdown, code fences, comments, or prose.",
    input.debugThoughts
      ? "The action object inside the wrapper must satisfy ACTION_SCHEMA_JSON and must be legal for PUBLIC_STATE_JSON."
      : "The JSON object must satisfy ACTION_SCHEMA_JSON and must be legal for PUBLIC_STATE_JSON.",
    input.debugThoughts
      ? "The thought must be a concise tactical read, not hidden chain-of-thought, and must not reveal private keys or unavailable hidden state."
      : undefined,
    ...currentTurnRequirements(input.gameId, input.publicState, input.debugThoughts === true),
    input.validationError
      ? `The previous action was rejected. You must choose a different legal action that fixes this exact error: ${input.validationError}`
      : undefined,
    input.validationError?.toLowerCase().includes("column is full")
      ? "Hard constraint: the last chosen Connect4 column is full. Do not choose that column again; choose from PUBLIC_STATE_JSON.validColumns only."
      : undefined,
    "",
    "MATCH_CONTEXT:",
    `Game id: ${input.gameId}`,
    `Your player id: ${input.playerId}`,
    "Use player ids only to interpret the state; do not copy them into the action unless the schema requires it.",
    input.extraContext === undefined ? undefined : "",
    input.extraContext === undefined ? undefined : "DERIVED_STATE_CONTEXT_JSON:",
    input.extraContext === undefined ? undefined : JSON.stringify(input.extraContext),
    "",
    "PUBLIC_STATE_JSON:",
    JSON.stringify(input.publicState),
    "",
    "ACTION_SCHEMA_JSON:",
    JSON.stringify(input.actionSchema),
  ].filter((line) => line !== undefined).join("\n");
}

function currentTurnRequirements(gameId: string, publicState: unknown, debugThoughts = false): string[] {
  const state = asRecord(publicState);
  const phase = typeof state.phase === "string" ? state.phase : undefined;
  if (!phase) {
    return [];
  }

  const generic = [
    `CURRENT_PHASE: ${phase}`,
    `Hard constraint: action.phase must be exactly "${phase}" for this turn.`,
    `Any JSON object with phase other than "${phase}" is invalid, even if it looks strategic.`,
  ];

  if (gameId !== "signal-duel") {
    return generic;
  }

  if (phase === "dialogue") {
    return [
      ...generic,
      debugThoughts
        ? 'ONLY_VALID_ACTION_OBJECT_FOR_THIS_TURN: {"phase":"dialogue","message":"one concise in-character sentence"}'
        : 'ONLY_VALID_JSON_FOR_THIS_TURN: {"phase":"dialogue","message":"one concise in-character sentence"}',
      'Do not return {"phase":"commit",...} during dialogue. Do not include a move field.',
      "Do not announce your literal committed move in dialogue; bluff, pressure, or misdirect instead.",
    ];
  }

  if (phase === "commit") {
    const validMoves = Array.isArray(state.validMoves)
      ? state.validMoves.filter((move): move is string => typeof move === "string")
      : [];
    return [
      ...generic,
      `VALID_MOVES_THIS_TURN: ${JSON.stringify(validMoves)}`,
      debugThoughts
        ? 'ONLY_VALID_ACTION_OBJECT_FOR_THIS_TURN: {"phase":"commit","move":"rock|paper|scissors"}. The move value must be one of VALID_MOVES_THIS_TURN.'
        : 'ONLY_VALID_JSON_FOR_THIS_TURN: {"phase":"commit","move":"rock|paper|scissors"}. The move value must be one of VALID_MOVES_THIS_TURN.',
      'Do not return {"phase":"dialogue",...} during commit. Do not include a message field.',
    ];
  }

  return generic;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseCompletion(text: string, debugThoughts: boolean): { action: unknown; debugThought?: string } {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("provider response was not a single JSON object");
  }
  const parsed = JSON.parse(trimmed);
  if (!debugThoughts) {
    return { action: parsed };
  }
  const wrapper = asRecord(parsed);
  if (!("action" in wrapper)) {
    throw new Error("provider response did not include action");
  }
  const thought = typeof wrapper.thought === "string" ? wrapper.thought.slice(0, 240) : undefined;
  return { action: wrapper.action, debugThought: thought };
}
