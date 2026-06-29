import AjvImport, { type ValidateFunction } from "ajv";
import type { MatchCoordinator } from "../../core/MatchCoordinator.js";
import type { MatchReceipt } from "../../core/types.js";
import type { AgentStrategy, AgentTurnLog } from "./demoAgents.js";

export interface AgentRunnerResult {
  matchId: string;
  status: "completed" | "stopped";
  receipt?: MatchReceipt;
  logs: AgentTurnLog[];
}

export interface AgentRunnerOptions {
  turnDelayInMs?: number;
}

const MAX_ACTION_ATTEMPTS = 3;

export class AgentRunner {
  private readonly ajv = new (AjvImport as unknown as new (options: {
    allErrors: boolean;
    strict: boolean;
  }) => { compile(schema: unknown): ValidateFunction })({ allErrors: true, strict: false });
  private readonly validators = new Map<string, ValidateFunction>();
  private running = false;
  private stopRequested = false;
  private readonly logs: AgentTurnLog[] = [];
  private lastError?: string;

  constructor(
    private readonly coordinator: MatchCoordinator,
    private readonly agents: AgentStrategy[],
    private readonly options: AgentRunnerOptions = {},
  ) {}

  validatorForSchema(schema: unknown): ValidateFunction {
    const key = JSON.stringify(schema);
    const cached = this.validators.get(key);
    if (cached) {
      return cached;
    }
    const validate = this.ajv.compile(schema);
    this.validators.set(key, validate);
    return validate;
  }

  stop(): void {
    this.stopRequested = true;
  }

  getLogs(): AgentTurnLog[] {
    return [...this.logs];
  }

  getLastError(): string | undefined {
    return this.lastError;
  }

  async run(matchId: string): Promise<AgentRunnerResult> {
    if (this.running) {
      throw new Error("Demo agents are already running");
    }
    this.running = true;
    this.stopRequested = false;
    this.lastError = undefined;

    try {
      while (!this.stopRequested) {
        const match = this.coordinator.getMatch(matchId);
        if (!match) {
          throw new Error(`Unknown match: ${matchId}`);
        }
        if (match.receipt || match.status === "paid" || match.status === "failed") {
          return { matchId, status: "completed", receipt: match.receipt, logs: this.getLogs() };
        }
        if (match.status !== "active") {
          await delay(100);
          continue;
        }

        let moved = false;
        for (const agent of this.agents) {
          if (agent.gameIds && !agent.gameIds.includes(match.gameId)) {
            continue;
          }
          const state = this.coordinator.getAgentState(matchId, agent.playerId);
          if (!state.yourTurn) {
            continue;
          }
          let validationError: string | undefined;
          let movedThisAgent = false;
          for (let attempt = 1; attempt <= MAX_ACTION_ATTEMPTS; attempt += 1) {
            const freshState = this.coordinator.getAgentState(matchId, agent.playerId);
            const decision = await agent.decide({
              gameId: freshState.gameId,
              publicState: freshState.publicState,
              actionSchema: freshState.actionSchema,
              playerId: agent.playerId,
              validationError,
            });
            const phaseCheck = this.validateActionForTurn(
              freshState.publicState,
              freshState.actionSchema,
              decision.action,
              agent.playerId,
              freshState.round,
            );
            if (!phaseCheck.ok) {
              validationError = phaseCheck.error;
              const log = withValidationError(decision.log, validationError);
              this.logs.push(log);
              console.log(JSON.stringify({ event: "agent_turn_invalid", attempt, ...log }));
              continue;
            }

            this.logs.push(decision.log);
            console.log(JSON.stringify({ event: "agent_turn", attempt, ...decision.log }));
            const submitted = await this.coordinator.submitMove(
              matchId,
              agent.playerId,
              decision.action,
            );
            this.coordinator.recordAgentInferenceTurn(
              matchId,
              agent.playerId,
              decision.log.inferenceMode,
            );
            if (!submitted.ok) {
              validationError = this.contextualError({
                error: submitted.error ?? "Agent move was rejected",
                playerId: agent.playerId,
                round: freshState.round,
                publicState: freshState.publicState,
                action: decision.action,
              });
              const log = withValidationError(decision.log, validationError);
              this.logs[this.logs.length - 1] = log;
              console.log(JSON.stringify({ event: "agent_turn_rejected", attempt, ...log }));
              continue;
            }

            moved = true;
            movedThisAgent = true;
            if (submitted.receipt) {
              return { matchId, status: "completed", receipt: submitted.receipt, logs: this.getLogs() };
            }
            if (this.options.turnDelayInMs && this.options.turnDelayInMs > 0) {
              await delay(this.options.turnDelayInMs);
            }
            break;
          }

          if (!movedThisAgent) {
            throw new Error(
              validationError ??
                `Agent action rejected after ${MAX_ACTION_ATTEMPTS} attempts for playerId=${agent.playerId}`,
            );
          }
        }

        if (!moved) {
          await delay(100);
        }
      }

      return { matchId, status: "stopped", logs: this.getLogs() };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.running = false;
    }
  }

  private validateActionForTurn(
    publicState: unknown,
    actionSchema: unknown,
    action: unknown,
    playerId: string,
    round: number,
  ): { ok: true } | { ok: false; error: string } {
    const validate = this.validatorForSchema(actionSchema);
    if (!validate(action)) {
      return {
        ok: false,
        error: this.contextualError({
          error: `Action failed schema validation: ${formatAjvError(validate.errors)}`,
          playerId,
          round,
          publicState,
          action,
        }),
      };
    }

    const expectedPhase = phaseFromPublicState(publicState);
    const actualPhase = phaseFromAction(action);
    if (expectedPhase && actualPhase && expectedPhase !== actualPhase) {
      return {
        ok: false,
        error: this.contextualError({
          error: `Action phase mismatch`,
          playerId,
          round,
          publicState,
          action,
        }),
      };
    }

    return { ok: true };
  }

  private contextualError(input: {
    error: string;
    playerId: string;
    round: number;
    publicState: unknown;
    action: unknown;
  }): string {
    const expectedPhase = phaseFromPublicState(input.publicState) ?? "unknown";
    const actualAction = phaseFromAction(input.action) ?? "unknown";
    return [
      input.error,
      `playerId=${input.playerId}`,
      `round=${input.round}`,
      `expectedPhase=${expectedPhase}`,
      `actualAction=${actualAction}`,
    ].join("; ");
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function phaseFromPublicState(publicState: unknown): string | undefined {
  if (typeof publicState !== "object" || publicState === null || Array.isArray(publicState)) {
    return undefined;
  }
  const phase = (publicState as Record<string, unknown>).phase;
  return typeof phase === "string" ? phase : undefined;
}

function phaseFromAction(action: unknown): string | undefined {
  if (typeof action !== "object" || action === null || Array.isArray(action)) {
    return undefined;
  }
  const phase = (action as Record<string, unknown>).phase;
  return typeof phase === "string" ? phase : undefined;
}

function withValidationError(log: AgentTurnLog, error: string): AgentTurnLog {
  return {
    ...log,
    validationResult: { ok: false, error },
  };
}

function formatAjvError(errors: ValidateFunction["errors"]): string {
  return errors?.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ") ?? "";
}
