import AjvImport, { type ValidateFunction } from "ajv";
import type { MatchCoordinator } from "../core/MatchCoordinator.js";
import type { MatchReceipt } from "../core/types.js";
import type { AgentStrategy, AgentTurnLog } from "./demoAgents.js";

export interface AgentRunnerResult {
  matchId: string;
  status: "completed" | "stopped";
  receipt?: MatchReceipt;
  logs: AgentTurnLog[];
}

export class AgentRunner {
  private readonly ajv = new (AjvImport as unknown as new (options: {
    allErrors: boolean;
    strict: boolean;
  }) => { compile(schema: unknown): ValidateFunction })({ allErrors: true, strict: false });
  private readonly validators = new Map<string, ValidateFunction>();
  private running = false;
  private stopRequested = false;
  private readonly logs: AgentTurnLog[] = [];

  constructor(
    private readonly coordinator: MatchCoordinator,
    private readonly agents: AgentStrategy[],
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

  async run(matchId: string): Promise<AgentRunnerResult> {
    if (this.running) {
      throw new Error("Demo agents are already running");
    }
    this.running = true;
    this.stopRequested = false;

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
          const state = this.coordinator.getAgentState(matchId, agent.playerId);
          if (!state.yourTurn) {
            continue;
          }
          const decision = await agent.decide({
            gameId: state.gameId,
            publicState: state.publicState,
            actionSchema: state.actionSchema,
            playerId: agent.playerId,
          });
          this.logs.push(decision.log);
          console.log(JSON.stringify({ event: "agent_turn", ...decision.log }));
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
            throw new Error(submitted.error ?? "Agent move was rejected");
          }
          moved = true;
          if (submitted.receipt) {
            return { matchId, status: "completed", receipt: submitted.receipt, logs: this.getLogs() };
          }
        }

        if (!moved) {
          await delay(100);
        }
      }

      return { matchId, status: "stopped", logs: this.getLogs() };
    } finally {
      this.running = false;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
