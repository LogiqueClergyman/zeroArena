import Fastify from "fastify";
import cors from "@fastify/cors";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentRunner } from "./agents/AgentRunner.js";
import { createAggressiveAgent, createCautiousAgent } from "./agents/demoAgents.js";
import { MockProvider } from "./agents/providers/MockProvider.js";
import { ZeroGServingProvider } from "./agents/providers/ZeroGServingProvider.js";
import { registerRoutes, type DemoMatchFactory } from "./api/routes.js";
import { MatchCoordinator } from "./core/MatchCoordinator.js";
import type { Player } from "./core/types.js";
import { SovereignBluff } from "./games/SovereignBluff.js";
import { MockArchiveAdapter } from "./integrations/MockArchiveAdapter.js";
import { ZeroGStorageAdapter } from "./integrations/ZeroGStorageAdapter.js";
import { ContractPrizePoolAdapter } from "./integrations/ContractPrizePoolAdapter.js";

loadEnv({ path: resolve(process.cwd(), ".env") });

class DemoMatchService implements DemoMatchFactory {
  constructor(
    private readonly coordinator: MatchCoordinator,
    private readonly prizePool: ContractPrizePoolAdapter,
    private readonly players: Player[],
  ) {}

  async createDemoMatch(): Promise<{
    matchId: string;
    players: Array<{ id: string; name: string; walletAddress: string }>;
  }> {
    const match = this.coordinator.createMatch("sovereign-bluff", this.players);
    try {
      await this.prizePool.createAndFund({
        matchId: match.id,
        players: this.players,
      });
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

export async function buildServer(env: NodeJS.ProcessEnv = process.env) {
  validateStartup(env);
  const localDevAllowMocks = env.LOCAL_DEV_ALLOW_MOCKS === "true";
  const engine = new SovereignBluff();
  const engines = [engine];
  const prizePool = new ContractPrizePoolAdapter({
    rpcUrl: env.EVM_RPC_URL ?? "",
    ownerPrivateKey: env.EVM_PRIVATE_KEY ?? "",
    prizePoolAddress: env.PRIZE_POOL_ADDRESS ?? "",
    stakeWei: env.MATCH_STAKE_WEI ?? "",
    rulesHash: env.SOVEREIGN_BLUFF_RULEBOOK_HASH ?? "",
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
    rulebook: {
      rulesHash: env.SOVEREIGN_BLUFF_RULEBOOK_HASH ?? "",
      rulesUrl: env.SOVEREIGN_BLUFF_RULEBOOK_URL ?? "",
      rulesVersion: env.SOVEREIGN_BLUFF_RULEBOOK_VERSION ?? "",
    },
  });
  const provider =
    env.AGENT_INFERENCE_MODE === "0g-serving"
      ? new ZeroGServingProvider({
          rpcUrl: env.ZERO_G_EVM_RPC_URL ?? env.EVM_RPC_URL ?? "https://evmrpc-testnet.0g.ai",
          providerAddress: env.ZERO_G_PROVIDER_ADDRESS,
          model: env.ZERO_G_SERVING_MODEL,
          autoFundBufferMultiplier: Number(env.ZERO_G_AUTO_FUND_BUFFER_MULTIPLIER ?? 1),
          requestSpacingMs: Number(env.ZERO_G_INFERENCE_REQUEST_SPACING_MS ?? 7000),
          privateKeysByRef: {
            AGENT_ALPHA_PRIVATE_KEY: env.AGENT_ALPHA_PRIVATE_KEY ?? "",
            AGENT_BETA_PRIVATE_KEY: env.AGENT_BETA_PRIVATE_KEY ?? "",
          },
        })
      : new MockProvider();

  const players: Player[] = [
    {
      id: "agent_alpha",
      name: "Alpha",
      walletAddress: env.AGENT_ALPHA_WALLET_ADDRESS ?? "0x00000000000000000000000000000000000000a1",
      agentKind: env.AGENT_INFERENCE_MODE === "0g-serving" ? "0g-serving" : "mock",
    },
    {
      id: "agent_beta",
      name: "Beta",
      walletAddress: env.AGENT_BETA_WALLET_ADDRESS ?? "0x00000000000000000000000000000000000000b2",
      agentKind: env.AGENT_INFERENCE_MODE === "0g-serving" ? "0g-serving" : "mock",
    },
  ];

  const runner = new AgentRunner(coordinator, []);
  const agents = [
    createCautiousAgent({
      playerId: players[0].id,
      walletAddress: players[0].walletAddress,
      privateKeyRef: "AGENT_ALPHA_PRIVATE_KEY",
      provider,
      allowMockFallback: localDevAllowMocks,
      validatorForSchema: (schema) => runner.validatorForSchema(schema),
    }),
    createAggressiveAgent({
      playerId: players[1].id,
      walletAddress: players[1].walletAddress,
      privateKeyRef: "AGENT_BETA_PRIVATE_KEY",
      provider,
      allowMockFallback: localDevAllowMocks,
      validatorForSchema: (schema) => runner.validatorForSchema(schema),
    }),
  ];
  const activeRunner = new AgentRunner(coordinator, agents);
  const app = Fastify({ logger: true });
  await app.register(cors, {
    origin: parseCorsOrigins(env.CORS_ORIGIN),
    methods: ["GET", "POST", "OPTIONS"],
  });
  await registerRoutes(app, {
    coordinator,
    engines,
    runner: activeRunner,
    demoMatchFactory: new DemoMatchService(coordinator, prizePool, players),
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
    "AGENT_ALPHA_PRIVATE_KEY",
    "AGENT_BETA_PRIVATE_KEY",
  ].filter((key) => !env[key]);
  if (missingContractEnv.length) {
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

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT ?? 3001);
  const app = await buildServer();
  await app.listen({ port, host: "0.0.0.0" });
}
