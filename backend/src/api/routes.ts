import type { FastifyInstance } from "fastify";
import type { AgentRunner } from "../agents/AgentRunner.js";
import type { MatchCoordinator } from "../core/MatchCoordinator.js";
import type { IGameEngine } from "../games/IGameEngine.js";

export interface DemoMatchFactory {
  createDemoMatch(): Promise<{
    matchId: string;
    players: Array<{ id: string; name: string; walletAddress: string }>;
  }>;
}

export interface RegisterRoutesOptions {
  coordinator: MatchCoordinator;
  engines: IGameEngine[];
  runner: AgentRunner;
  demoMatchFactory: DemoMatchFactory;
}

export async function registerRoutes(
  app: FastifyInstance,
  options: RegisterRoutesOptions,
): Promise<void> {
  const { coordinator, engines, runner, demoMatchFactory } = options;

  app.get("/health", async () => ({ ok: true }));

  app.get("/games", async () =>
    engines.map((engine) => ({
      id: engine.id,
      name: engine.name,
      minPlayers: engine.minPlayers,
      maxPlayers: engine.maxPlayers,
      actionSchema: engine.actionSchema,
    })),
  );

  app.post("/matches/demo", async () => demoMatchFactory.createDemoMatch());

  app.get("/matches/live", async () => coordinator.listLiveMatches());

  app.get<{ Params: { id: string } }>("/match/:id/ui", async (request, reply) => {
    const match = coordinator.getMatch(request.params.id);
    if (!match) {
      return reply.code(404).send({ error: "Unknown match" });
    }
    const engine = engines.find((candidate) => candidate.id === match.gameId);
    if (!engine) {
      return reply.code(404).send({ error: "Unknown game" });
    }
    const rendered = engine.renderForUI(match.state);
    const data: Record<string, unknown> =
      typeof rendered.data === "object" && rendered.data !== null && !Array.isArray(rendered.data)
        ? { ...(rendered.data as Record<string, unknown>) }
        : { value: rendered.data };
    data.players = match.players.map((player) => ({
      id: player.id,
      name: player.name,
      walletAddress: player.walletAddress,
      inferenceMode: player.agentKind,
      balance: findRenderedBalance(data.players, player.id),
    }));
    try {
      const pool = await coordinator.getPrizePoolStatus(match.id);
      data.prizePoolAddress = pool.prizePoolAddress;
      data.stakeWei = pool.stakeWei;
      data.totalPoolWei = pool.totalPoolWei;
      data.rulesHash = pool.rulesHash;
      data.fullyFunded = pool.fullyFunded;
      data.paid = pool.paid;
      data.fundingTxHashes = pool.fundingTxHashes;
      data.poolCreationTxHash = pool.poolCreationTxHash;
    } catch (error) {
      data.prizePoolError = errorMessage(error);
    }
    return {
      matchId: match.id,
      gameId: match.gameId,
      status: match.status,
      error: match.failureReason,
      receipt: match.receipt,
      render: { ...rendered, data },
      agentLogs: runner.getLogs().filter((log) => log.playerId in playerIndex(match.players)),
      runnerError: runner.getLastError(),
    };
  });

  app.get<{ Params: { id: string } }>("/match/:id/history", async (request) =>
    coordinator.getHistory(request.params.id),
  );

  app.get<{ Params: { id: string } }>("/match/:id/receipt", async (request, reply) => {
    const receipt = coordinator.getReceipt(request.params.id);
    if (!receipt) {
      return reply.code(404).send({ error: "Receipt not available" });
    }
    return receipt;
  });

  app.get<{ Params: { id: string }; Querystring: { playerId?: string } }>(
    "/match/:id/state",
    async (request, reply) => {
      if (!request.query.playerId) {
        return reply.code(400).send({ error: "playerId query parameter is required" });
      }
      try {
        return coordinator.getAgentState(request.params.id, request.query.playerId);
      } catch (error) {
        return reply.code(404).send({ error: errorMessage(error) });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { playerId?: string; action?: unknown } }>(
    "/match/:id/move",
    async (request, reply) => {
      if (!request.body?.playerId) {
        return reply.code(400).send({ error: "playerId is required" });
      }
      const result = await coordinator.submitMove(
        request.params.id,
        request.body.playerId,
        request.body.action,
      );
      if (!result.ok) {
        return reply.code(400).send(result);
      }
      return result;
    },
  );

  app.post<{ Body: { matchId?: string } }>("/agents/demo/start", async (request, reply) => {
    const matchId = request.body?.matchId ?? coordinator.listLiveMatches()[0]?.matchId;
    if (!matchId) {
      return reply.code(400).send({ error: "matchId is required when no live match exists" });
    }
    return runner.run(matchId);
  });

  app.post("/agents/demo/stop", async () => {
    runner.stop();
    return { ok: true };
  });
}

function findRenderedBalance(players: unknown, playerId: string): unknown {
  if (!Array.isArray(players)) {
    return undefined;
  }
  const player = players.find((candidate) => {
    const record = candidate as Record<string, unknown>;
    return record.id === playerId;
  }) as Record<string, unknown> | undefined;
  return player?.balance;
}

function playerIndex(players: Array<{ id: string }>): Record<string, true> {
  return Object.fromEntries(players.map((player) => [player.id, true]));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
