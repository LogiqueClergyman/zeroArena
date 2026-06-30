import Fastify from "fastify";
import cors from "@fastify/cors";
import { config as loadEnv } from "dotenv";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyMessage } from "ethers";
import {
  registerRoutes,
  type AuthService,
  type DemoMatchFactory,
  type LobbyService,
} from "./api/routes.js";
import { MatchCoordinator, type RulebookCommitment } from "./core/MatchCoordinator.js";
import type { Player } from "./core/types.js";
import type { IGameEngine } from "@zeroarena/game-sdk";
import { loadBuiltInGames } from "./game-registry/index.js";
import { MockArchiveAdapter } from "./integrations/MockArchiveAdapter.js";
import { ZeroGStorageAdapter } from "./integrations/ZeroGStorageAdapter.js";
import { ContractPrizePoolAdapter } from "./integrations/ContractPrizePoolAdapter.js";
import { LocalDevPrizePoolAdapter } from "./integrations/LocalDevPrizePoolAdapter.js";
import type { PrizePoolAdapter } from "./integrations/PrizePoolAdapter.js";

loadEnv({ path: resolve(process.cwd(), ".env") });

class DemoMatchService implements DemoMatchFactory {
  constructor(
    private readonly coordinator: MatchCoordinator,
    private readonly prizePool: PrizePoolAdapter & {
      createAndFund?: (input: { matchId: string; players: Player[]; rulesHash?: string }) => Promise<unknown>;
    },
    private readonly players: Player[],
    private readonly rulebooks: Record<string, RulebookCommitment>,
  ) {}

  async createDemoMatch(gameId = "sovereign-bluff"): Promise<{
    matchId: string;
    players: Array<{ id: string; name: string; walletAddress: string }>;
  }> {
    const rulesHash = this.rulebooks[gameId]?.rulesHash;
    if (!rulesHash) {
      throw new Error(`Missing rulebook hash for ${gameId}`);
    }
    const match = this.coordinator.createMatch(gameId, this.players);
    try {
      if (this.prizePool.createAndFund) {
        await this.prizePool.createAndFund({
          matchId: match.id,
          players: this.players,
          rulesHash,
        });
      } else {
        await this.prizePool.createPool({
          matchId: match.id,
          players: this.players,
          stakeWei: process.env.MATCH_STAKE_WEI ?? "1000",
          rulesHash,
        });
      }
      await this.coordinator.activateMatch(match.id);
      return {
        matchId: match.id,
        players: match.players.map((player) => ({
          id: player.id,
          name: player.name,
          walletAddress: player.walletAddress,
        })),
      };
    } catch (error) {
      this.coordinator.failMatch(match.id, errorMessage(error));
      throw error;
    }
  }
}

class ExternalLobbyService implements LobbyService {
  private readonly waiting = new Map<string, Player[]>();
  private readonly assignedByWallet = new Map<string, string>();
  private readonly enginesById: Map<string, IGameEngine>;

  constructor(
    private readonly coordinator: MatchCoordinator,
    private readonly prizePool: PrizePoolAdapter & {
      createAndFund?: (input: { matchId: string; players: Player[]; rulesHash?: string }) => Promise<unknown>;
    },
    private readonly rulebooks: Record<string, RulebookCommitment>,
    engines: IGameEngine[],
  ) {
    this.enginesById = new Map(engines.map((engine) => [engine.id, engine]));
  }

  async join(input: { gameId: string; walletAddress: string; name?: string }) {
    const engine = this.enginesById.get(input.gameId);
    if (!engine) {
      throw new Error(`Unknown game: ${input.gameId}`);
    }

    const assigned = this.assignedByWallet.get(keyFor(input.gameId, input.walletAddress));
    if (assigned) {
      const match = this.coordinator.getMatch(assigned);
      const player = match?.players.find(
        (candidate) => candidate.walletAddress.toLowerCase() === input.walletAddress.toLowerCase(),
      );
      if (match && player) {
        if (match.status !== "paid" && match.status !== "failed") {
          return {
            status: "matched" as const,
            gameId: input.gameId,
            matchId: match.id,
            playerId: player.id,
            players: match.players,
            tokenRequired: true,
          };
        }
      }
      this.assignedByWallet.delete(keyFor(input.gameId, input.walletAddress));
    }

    const queue = this.waiting.get(input.gameId) ?? [];
    const existing = queue.find(
      (player) => player.walletAddress.toLowerCase() === input.walletAddress.toLowerCase(),
    );
    if (existing) {
      return {
        status: "waiting" as const,
        gameId: input.gameId,
        playerId: existing.id,
        players: queue,
        tokenRequired: true,
        message: waitingMessage(engine, queue.length),
      };
    }

    const player = this.playerFromJoin(input);
    queue.push(player);
    this.waiting.set(input.gameId, queue);

    if (queue.length < engine.maxPlayers) {
      return {
        status: "waiting" as const,
        gameId: input.gameId,
        playerId: player.id,
        players: queue,
        tokenRequired: true,
        message: waitingMessage(engine, queue.length),
      };
    }

    const players = queue.splice(0, engine.maxPlayers);
    if (queue.length === 0) {
      this.waiting.delete(input.gameId);
    }
    const match = this.coordinator.createMatch(input.gameId, players);
    const rulesHash = this.rulebooks[input.gameId]?.rulesHash;
    if (!rulesHash) {
      this.coordinator.failMatch(match.id, `Missing rulebook hash for ${input.gameId}`);
      throw new Error(`Missing rulebook hash for ${input.gameId}`);
    }
    try {
      if (this.prizePool.createAndFund) {
        await this.prizePool.createAndFund({ matchId: match.id, players, rulesHash });
      } else {
        await this.prizePool.createPool({
          matchId: match.id,
          players,
          stakeWei: process.env.MATCH_STAKE_WEI ?? "1000",
          rulesHash,
        });
      }
      await this.coordinator.activateMatch(match.id);
    } catch (error) {
      this.coordinator.failMatch(match.id, errorMessage(error));
      throw error;
    }
    for (const player of players) {
      this.assignedByWallet.set(keyFor(input.gameId, player.walletAddress), match.id);
    }
    return {
      status: "matched" as const,
      gameId: input.gameId,
      matchId: match.id,
      playerId: player.id,
      players,
      tokenRequired: true,
    };
  }

  private playerFromJoin(input: { walletAddress: string; name?: string }): Player {
    return {
      id: playerIdForWallet(input.walletAddress),
      name: input.name ?? shortWallet(input.walletAddress),
      walletAddress: input.walletAddress,
      agentKind: "mock",
    };
  }
}

class WalletAuthService implements AuthService {
  readonly required = true;
  private readonly challenges = new Map<string, { nonce: string; message: string; expiresAt: number }>();
  private readonly tokens = new Map<string, { walletAddress: string; expiresAt: number }>();

  constructor(private readonly allowLocalDevSignature: boolean) {}

  createChallenge(walletAddress: string): { walletAddress: string; nonce: string; message: string } {
    const nonce = randomBytes(16).toString("hex");
    const message = [
      "ZeroArena agent authentication",
      `wallet=${walletAddress}`,
      `nonce=${nonce}`,
      "Sign this message to receive a short-lived bearer token. Do not send private keys.",
    ].join("\n");
    this.challenges.set(walletAddress.toLowerCase(), {
      nonce,
      message,
      expiresAt: Date.now() + 5 * 60_000,
    });
    return { walletAddress, nonce, message };
  }

  async verify(input: { walletAddress: string; signature: string }) {
    const challenge = this.challenges.get(input.walletAddress.toLowerCase());
    if (!challenge || challenge.expiresAt < Date.now()) {
      throw new Error("Auth challenge is missing or expired");
    }
    if (input.signature !== "local-dev") {
      const recovered = verifyMessage(challenge.message, input.signature);
      if (recovered.toLowerCase() !== input.walletAddress.toLowerCase()) {
        throw new Error("Signature does not match wallet address");
      }
    } else if (!this.allowLocalDevSignature) {
      throw new Error("local-dev auth signature is only allowed when LOCAL_DEV_ALLOW_MOCKS=true");
    }
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    this.tokens.set(token, {
      walletAddress: input.walletAddress,
      expiresAt: Date.parse(expiresAt),
    });
    this.challenges.delete(input.walletAddress.toLowerCase());
    return { token, walletAddress: input.walletAddress, expiresAt };
  }

  walletForToken(token: string): string | undefined {
    const record = this.tokens.get(token);
    if (!record || record.expiresAt < Date.now()) {
      if (record) {
        this.tokens.delete(token);
      }
      return undefined;
    }
    return record.walletAddress;
  }
}

export async function buildServer(env: NodeJS.ProcessEnv = process.env) {
  validateStartup(env);
  const localDevAllowMocks = env.LOCAL_DEV_ALLOW_MOCKS === "true";
  const registeredGames = loadBuiltInGames(env);
  const engines = registeredGames.map((game) => game.engine);
  const rulebooks = Object.fromEntries(
    registeredGames.map((game) => [game.engine.id, game.rulebook]),
  );
  const prizePool = localDevAllowMocks && env.LOCAL_DEV_PRIZE_POOL === "mock"
    ? new LocalDevPrizePoolAdapter({
        stakeWei: env.MATCH_STAKE_WEI,
      })
    : new ContractPrizePoolAdapter({
        rpcUrl: env.EVM_RPC_URL ?? "",
        ownerPrivateKey: env.EVM_PRIVATE_KEY ?? "",
        prizePoolAddress: env.PRIZE_POOL_ADDRESS ?? "",
        stakeWei: env.MATCH_STAKE_WEI ?? "",
        rulesHash: env.SOVEREIGN_BLUFF_RULEBOOK_HASH ?? env.CONNECT4_RULEBOOK_HASH ?? "",
        expectedChainId: BigInt(env.EVM_CHAIN_ID ?? "16602"),
        privateKeysByRef: {
          AGENT_ALPHA_PRIVATE_KEY: env.AGENT_ALPHA_PRIVATE_KEY,
          AGENT_BETA_PRIVATE_KEY: env.AGENT_BETA_PRIVATE_KEY,
        },
      });
  const archive =
    env.ARCHIVE_MODE === "0g"
      ? new ZeroGStorageAdapter({
          evmRpcUrl: env.ZERO_G_STORAGE_RPC ?? env.EVM_RPC_URL ?? "",
          privateKey: env.ZERO_G_STORAGE_PRIVATE_KEY ?? "",
          indexerRpc:
            env.ZERO_G_STORAGE_INDEXER_RPC ?? "https://indexer-storage-testnet-turbo.0g.ai",
        })
      : new MockArchiveAdapter();
  const coordinator = new MatchCoordinator({
    engines,
    archive,
    prizePool,
    rulebook: rulebooks,
  });

  const players: Player[] = [
    {
      id: playerIdForWallet(env.AGENT_ALPHA_WALLET_ADDRESS ?? "0x00000000000000000000000000000000000000a1"),
      name: "Alpha",
      walletAddress: env.AGENT_ALPHA_WALLET_ADDRESS ?? "0x00000000000000000000000000000000000000a1",
      agentKind: env.AGENT_INFERENCE_MODE === "0g-serving" ? "0g-serving" : "mock",
    },
    {
      id: playerIdForWallet(env.AGENT_BETA_WALLET_ADDRESS ?? "0x00000000000000000000000000000000000000b2"),
      name: "Beta",
      walletAddress: env.AGENT_BETA_WALLET_ADDRESS ?? "0x00000000000000000000000000000000000000b2",
      agentKind: env.AGENT_INFERENCE_MODE === "0g-serving" ? "0g-serving" : "mock",
    },
  ];
  const app = Fastify({ logger: true });
  await app.register(cors, {
    origin: parseCorsOrigins(env.CORS_ORIGIN),
    methods: ["GET", "POST", "OPTIONS"],
  });
  await registerRoutes(app, {
    coordinator,
    engines,
    rulebooks,
    lobby: new ExternalLobbyService(coordinator, prizePool, rulebooks, engines),
    auth: new WalletAuthService(localDevAllowMocks),
    demoMatchFactory: new DemoMatchService(coordinator, prizePool, players, rulebooks),
  });
  return app;
}

function parseCorsOrigins(value: string | undefined): Array<string | RegExp> {
  return (value ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .concat(["/^http:\\/\\/localhost:517\\d$/", "/^http:\\/\\/127\\.0\\.0\\.1:517\\d$/"])
    .map((origin) => {
      if (origin.startsWith("/") && origin.endsWith("/")) {
        return new RegExp(origin.slice(1, -1));
      }
      return origin;
    });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function validateStartup(env: NodeJS.ProcessEnv): void {
  const localDevAllowMocks = env.LOCAL_DEV_ALLOW_MOCKS === "true";
  const mode = env.AGENT_INFERENCE_MODE ?? (localDevAllowMocks ? "mock" : "");
  if (mode !== "0g-serving" && mode !== "mock") {
    throw new Error("AGENT_INFERENCE_MODE must be 0g-serving; use LOCAL_DEV_ALLOW_MOCKS=true for mock");
  }
  if (!localDevAllowMocks && mode !== "0g-serving") {
    throw new Error("Judged mode requires AGENT_INFERENCE_MODE=0g-serving");
  }
  if (mode === "0g-serving") {
    const missing = [
      "AGENT_ALPHA_WALLET_ADDRESS",
      "AGENT_ALPHA_PRIVATE_KEY",
      "AGENT_BETA_WALLET_ADDRESS",
      "AGENT_BETA_PRIVATE_KEY",
    ].filter((key) => !env[key]);
    if (missing.length) {
      throw new Error(
        `AGENT_INFERENCE_MODE=0g-serving requires configured agent wallets: missing ${missing.join(", ")}`,
      );
    }
  }
  if (!localDevAllowMocks && env.ARCHIVE_MODE !== "0g") {
    throw new Error("Judged mode requires ARCHIVE_MODE=0g");
  }
  if (localDevAllowMocks && env.ARCHIVE_MODE && env.ARCHIVE_MODE !== "0g" && env.ARCHIVE_MODE !== "mock") {
    throw new Error("ARCHIVE_MODE must be either 0g or mock");
  }
  const payoutMode = env.PAYOUT_MODE ?? "contract";
  if (payoutMode !== "contract") {
    throw new Error("PAYOUT_MODE must be contract; payout mocks are not supported");
  }
  const missingContractEnv = [
    "EVM_RPC_URL",
    "EVM_PRIVATE_KEY",
    "PRIZE_POOL_ADDRESS",
    "MATCH_STAKE_WEI",
    "SOVEREIGN_BLUFF_RULEBOOK_HASH",
    "SOVEREIGN_BLUFF_RULEBOOK_URL",
    "SOVEREIGN_BLUFF_RULEBOOK_VERSION",
    "CONNECT4_RULEBOOK_HASH",
    "CONNECT4_RULEBOOK_URL",
    "CONNECT4_RULEBOOK_VERSION",
    "AGENT_ALPHA_PRIVATE_KEY",
    "AGENT_BETA_PRIVATE_KEY",
  ].filter((key) => !env[key]);
  if (!(localDevAllowMocks && env.LOCAL_DEV_PRIZE_POOL === "mock") && missingContractEnv.length) {
    throw new Error(
      `PAYOUT_MODE=contract requires live prize pool env: missing ${missingContractEnv.join(", ")}`,
    );
  }
  if (env.ARCHIVE_MODE === "0g") {
    const missingArchiveEnv = ["ZERO_G_STORAGE_PRIVATE_KEY"].filter((key) => !env[key]);
    if (missingArchiveEnv.length) {
      throw new Error(`ARCHIVE_MODE=0g requires ${missingArchiveEnv.join(", ")}`);
    }
  }
}

function keyFor(gameId: string, walletAddress: string): string {
  return `${gameId}:${walletAddress.toLowerCase()}`;
}

function playerIdForWallet(walletAddress: string): string {
  return walletAddress.toLowerCase();
}

function shortWallet(walletAddress: string): string {
  return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
}

function waitingMessage(engine: IGameEngine, waitingCount: number): string {
  const remaining = Math.max(0, engine.maxPlayers - waitingCount);
  return remaining === 1
    ? "Waiting for one more external player to join this game."
    : `Waiting for ${remaining} more external players to join this game.`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT ?? 3001);
  const app = await buildServer();
  await app.listen({ port, host: "0.0.0.0" });
}
