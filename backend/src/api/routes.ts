import type { FastifyInstance } from "fastify";
import type { IGameEngine } from "@zeroarena/game-sdk";
import type { MatchCoordinator } from "../core/MatchCoordinator.js";
import type { Player } from "../core/types.js";

export interface DemoMatchFactory {
  createDemoMatch(gameId?: string): Promise<{
    matchId: string;
    players: Array<{ id: string; name: string; walletAddress: string }>;
  }>;
}

export interface LobbyJoinResponse {
  status: "waiting" | "matched";
  gameId: string;
  playerId: string;
  matchId?: string;
  tokenRequired: boolean;
  message?: string;
  players?: Player[];
}

export interface LobbyService {
  join(input: { gameId: string; walletAddress: string; name?: string }): Promise<LobbyJoinResponse>;
}

export interface AuthService {
  createChallenge(walletAddress: string): { walletAddress: string; nonce: string; message: string };
  verify(input: { walletAddress: string; signature: string }): Promise<{ token: string; walletAddress: string; expiresAt: string }>;
  walletForToken(token: string): string | undefined;
  readonly required: boolean;
}

export interface RegisterRoutesOptions {
  coordinator: MatchCoordinator;
  engines: IGameEngine[];
  lobby: LobbyService;
  auth: AuthService;
  demoMatchFactory: DemoMatchFactory;
}

export async function registerRoutes(
  app: FastifyInstance,
  options: RegisterRoutesOptions,
): Promise<void> {
  const { coordinator, engines, lobby, auth, demoMatchFactory } = options;

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

  app.post<{ Body: { gameId?: string } }>("/matches/demo", async (request) =>
    demoMatchFactory.createDemoMatch(request.body?.gameId),
  );

  app.post<{ Body: { gameId?: string; walletAddress?: string; name?: string } }>(
    "/lobby/join",
    async (request, reply) => {
      const gameId = request.body?.gameId ?? "connect4";
      const walletAddress = request.body?.walletAddress;
      if (!walletAddress) {
        return reply.code(400).send({ error: "walletAddress is required" });
      }
      try {
        return await lobby.join({ gameId, walletAddress, name: request.body?.name });
      } catch (error) {
        return reply.code(400).send({ error: errorMessage(error) });
      }
    },
  );

  app.post<{ Body: { walletAddress?: string } }>("/auth/challenge", async (request, reply) => {
    if (!request.body?.walletAddress) {
      return reply.code(400).send({ error: "walletAddress is required" });
    }
    return auth.createChallenge(request.body.walletAddress);
  });

  app.post<{ Body: { walletAddress?: string; signature?: string } }>(
    "/auth/verify",
    async (request, reply) => {
      if (!request.body?.walletAddress || !request.body?.signature) {
        return reply.code(400).send({ error: "walletAddress and signature are required" });
      }
      try {
        return await auth.verify({
          walletAddress: request.body.walletAddress,
          signature: request.body.signature,
        });
      } catch (error) {
        return reply.code(401).send({ error: errorMessage(error) });
      }
    },
  );

  app.get("/matches/live", async () => {
    await coordinator.processLiveTimeouts();
    return coordinator.listLiveMatches();
  });

  app.get<{ Params: { id: string } }>("/match/:id/ui", async (request, reply) => {
    await processMatchTimeoutIfKnown(coordinator, request.params.id);
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
      agentLogs: [],
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
      const authError = authorizePlayerRequest({
        auth,
        header: request.headers.authorization,
        coordinator,
        matchId: request.params.id,
        playerId: request.query.playerId,
      });
      if (authError) {
        return reply.code(authError.statusCode).send({ error: authError.error });
      }
      try {
        await coordinator.processTimeouts(request.params.id);
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
      const authError = authorizePlayerRequest({
        auth,
        header: request.headers.authorization,
        coordinator,
        matchId: request.params.id,
        playerId: request.body.playerId,
      });
      if (authError) {
        return reply.code(authError.statusCode).send({ error: authError.error });
      }
      await coordinator.processTimeouts(request.params.id);
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
    return reply.code(410).send({
      error:
        "Backend-hosted demo agents have moved out of production backend. Run sdk/agent examples as external processes.",
    });
  });

  app.post("/agents/demo/stop", async () => {
    return {
      ok: true,
      message: "No backend-hosted agent runner is active. Stop the external SDK process instead.",
    };
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function processMatchTimeoutIfKnown(coordinator: MatchCoordinator, matchId: string): Promise<void> {
  if (!coordinator.getMatch(matchId)) {
    return;
  }
  await coordinator.processTimeouts(matchId);
}

function authorizePlayerRequest(input: {
  auth: AuthService;
  header: string | undefined;
  coordinator: MatchCoordinator;
  matchId: string;
  playerId: string;
}): { statusCode: number; error: string } | undefined {
  if (!input.auth.required) {
    return undefined;
  }
  const token = bearerToken(input.header);
  if (!token) {
    return { statusCode: 401, error: "Bearer token is required" };
  }
  const wallet = input.auth.walletForToken(token);
  if (!wallet) {
    return { statusCode: 401, error: "Bearer token is invalid or expired" };
  }
  const match = input.coordinator.getMatch(input.matchId);
  if (!match) {
    return { statusCode: 404, error: "Unknown match" };
  }
  const player = match.players.find((candidate) => candidate.id === input.playerId);
  if (!player) {
    return { statusCode: 403, error: "Token player is not in this match" };
  }
  if (player.walletAddress.toLowerCase() !== wallet.toLowerCase()) {
    return { statusCode: 403, error: "Bearer token wallet does not match match player wallet" };
  }
  return undefined;
}

function bearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}
