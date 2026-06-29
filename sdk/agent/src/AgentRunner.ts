import AjvImport, { type ValidateFunction } from "ajv";
import { ApiError, ZeroArenaClient } from "./ZeroArenaClient.js";
import type { AgentDecision, AgentState, AgentStrategy, MatchReceipt } from "./types.js";

export interface AgentRunnerOptions {
  gameId: string;
  walletAddress: string;
  name?: string;
  pollIntervalMs?: number;
  nearTimeoutMs?: number;
  decisionTimeoutMs?: number;
  maxInvalidAttempts?: number;
  failOnInvalidOutput?: boolean;
}

export class AgentRunner {
  private readonly ajv = new (AjvImport as unknown as new (options: {
    allErrors: boolean;
    strict: boolean;
  }) => { compile(schema: unknown): ValidateFunction })({ allErrors: true, strict: false });
  private readonly validators = new Map<string, ValidateFunction>();
  private stopping = false;
  private matchId?: string;
  private playerId?: string;

  constructor(
    private readonly client: ZeroArenaClient,
    private readonly strategy: AgentStrategy,
    private readonly options: AgentRunnerOptions,
  ) {}

  stop(): void {
    this.stopping = true;
  }

  async run(): Promise<MatchReceipt | undefined> {
    await this.client.authenticate();
    await this.joinUntilMatched();
    if (!this.matchId || !this.playerId) {
      throw new Error("Agent did not receive a match assignment");
    }

    process.once("SIGINT", () => {
      this.stopping = true;
      console.log(JSON.stringify({ event: "agent_shutdown_requested", matchId: this.matchId, playerId: this.playerId }));
    });

    while (!this.stopping) {
      const state = await this.client.getMatchState(this.matchId, this.playerId);
      if (state.receipt || isTerminal(state.status)) {
        const receipt = state.receipt ?? await this.tryReceipt(this.matchId);
        console.log(JSON.stringify({ event: "agent_finished", matchId: this.matchId, status: state.status, receipt }));
        return receipt;
      }
      if (!state.yourTurn) {
        await sleep(this.options.pollIntervalMs ?? 1000);
        continue;
      }
      await this.playTurn(state);
    }
    const receipt = this.matchId ? await this.tryReceipt(this.matchId) : undefined;
    console.log(JSON.stringify({ event: "agent_stopped", matchId: this.matchId, playerId: this.playerId, receipt }));
    return receipt;
  }

  private async joinUntilMatched(): Promise<void> {
    while (!this.stopping) {
      const joined = await this.client.joinLobby(this.options.gameId, this.options.walletAddress, this.options.name);
      this.playerId = joined.playerId;
      if (joined.status === "matched" && joined.matchId) {
        this.matchId = joined.matchId;
        console.log(JSON.stringify({ event: "agent_matched", matchId: this.matchId, playerId: this.playerId }));
        return;
      }
      console.log(JSON.stringify({ event: "agent_waiting_for_match", gameId: this.options.gameId, playerId: this.playerId }));
      await sleep(this.options.pollIntervalMs ?? 1000);
    }
  }

  private async playTurn(state: AgentState): Promise<void> {
    let validationError: string | undefined;
    const maxAttempts = this.options.maxInvalidAttempts ?? 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const fresh = attempt === 1 ? state : await this.client.getMatchState(state.matchId, state.playerId);
      if (!fresh.yourTurn || isTerminal(fresh.status)) {
        return;
      }
      const decision = await this.decideWithDeadline(fresh, validationError);
      const local = this.validate(fresh.actionSchema, decision.action);
      if (!local.ok) {
        validationError = `Local action schema validation failed: ${local.error}`;
        console.log(JSON.stringify({ event: "agent_invalid_local_action", attempt, matchId: fresh.matchId, playerId: fresh.playerId, error: validationError }));
        continue;
      }
      try {
        const submitted = await this.client.submitMove(fresh.matchId, fresh.playerId, decision.action);
        if (!submitted.ok) {
          validationError = submitted.error ?? "Backend rejected move";
          console.log(JSON.stringify({ event: "agent_move_rejected", attempt, matchId: fresh.matchId, playerId: fresh.playerId, error: validationError }));
          await sleep(300);
          continue;
        }
        console.log(JSON.stringify({
          event: "agent_move_submitted",
          matchId: fresh.matchId,
          playerId: fresh.playerId,
          action: decision.action,
          source: decision.source,
          provider: decision.provider,
          model: decision.model,
          latencyMs: decision.latencyMs,
          fallbackReason: decision.fallbackReason,
        }));
        return;
      } catch (error) {
        if (error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
          validationError = error.backendMessage;
          continue;
        }
        throw this.withContext(error, fresh);
      }
    }
    const latest = await this.client.getMatchState(state.matchId, state.playerId);
    if (latest.yourTurn && this.strategy.fallback) {
      const fallback = this.strategy.fallback({
        gameId: latest.gameId,
        publicState: latest.publicState,
        actionSchema: latest.actionSchema,
        playerId: latest.playerId,
        reason: `invalid output after ${maxAttempts} attempts: ${validationError ?? "unknown validation error"}`,
      });
      const local = this.validate(latest.actionSchema, fallback.action);
      if (local.ok) {
        const submitted = await this.client.submitMove(latest.matchId, latest.playerId, fallback.action);
        if (submitted.ok) {
          console.log(JSON.stringify({
            event: "agent_fallback_move_submitted",
            matchId: latest.matchId,
            playerId: latest.playerId,
            action: fallback.action,
            source: fallback.source,
            fallbackReason: fallback.fallbackReason,
          }));
          return;
        }
        validationError = submitted.error ?? "Backend rejected fallback move";
      } else {
        validationError = `Fallback action schema validation failed: ${local.error}`;
      }
    }
    if (this.options.failOnInvalidOutput || !this.strategy.fallback) {
      throw new Error(`Agent failed to produce a valid move after ${maxAttempts} attempts: ${validationError}`);
    }
  }

  private async decideWithDeadline(state: AgentState, validationError: string | undefined): Promise<AgentDecision> {
    const deadlineAt = state.turnExpiresAt ? Date.parse(state.turnExpiresAt) : Date.now() + state.timeoutInMs;
    const nearTimeoutMs = this.options.nearTimeoutMs ?? 3000;
    const fallback = (reason: string): AgentDecision | undefined => this.strategy.fallback?.({
      gameId: state.gameId,
      publicState: state.publicState,
      actionSchema: state.actionSchema,
      playerId: state.playerId,
      reason,
    });
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= nearTimeoutMs) {
      const fallbackDecision = fallback("turn deadline is near");
      if (fallbackDecision) {
        return fallbackDecision;
      }
    }
    const decisionBudgetMs = Math.max(
      250,
      Math.min(this.options.decisionTimeoutMs ?? 15_000, Math.max(250, remainingMs - nearTimeoutMs)),
    );
    try {
      return await withTimeout(
        this.strategy.decide({
          gameId: state.gameId,
          publicState: state.publicState,
          actionSchema: state.actionSchema,
          playerId: state.playerId,
          validationError,
          deadlineAt,
        }),
        decisionBudgetMs,
        `strategy decision timed out after ${decisionBudgetMs}ms`,
      );
    } catch (error) {
      const fallbackDecision = fallback(error instanceof Error ? error.message : String(error));
      if (fallbackDecision) {
        console.log(JSON.stringify({
          event: "agent_decision_fallback",
          matchId: state.matchId,
          playerId: state.playerId,
          reason: fallbackDecision.fallbackReason,
        }));
        return fallbackDecision;
      }
      throw error;
    }
  }

  private validate(schema: unknown, action: unknown): { ok: true } | { ok: false; error: string } {
    const key = JSON.stringify(schema);
    const validate = this.validators.get(key) ?? this.ajv.compile(schema);
    this.validators.set(key, validate);
    if (validate(action)) {
      return { ok: true };
    }
    return {
      ok: false,
      error: validate.errors?.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ") ?? "invalid action",
    };
  }

  private async tryReceipt(matchId: string): Promise<MatchReceipt | undefined> {
    try {
      return await this.client.getReceipt(matchId);
    } catch {
      return undefined;
    }
  }

  private withContext(error: unknown, state: AgentState): Error {
    const message = error instanceof Error ? error.message : String(error);
    return new Error([
      message,
      `endpoint=/match/${state.matchId}/move`,
      `matchId=${state.matchId}`,
      `playerId=${state.playerId}`,
      "suggestedFix=check backend availability, auth token, and whether the turn timed out",
    ].join("; "));
  }
}

function isTerminal(status: string): boolean {
  return ["paid", "failed", "finished", "archived"].includes(status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}
