import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { Connect4 } from "@zeroarena/game-connect4";
import { AgentRunner } from "./agents/AgentRunner.js";
import { createConnect4Agent } from "./agents/connect4Agents.js";
import { ZeroGServingProvider } from "./agents/providers/ZeroGServingProvider.js";
import { MatchCoordinator } from "../core/MatchCoordinator.js";
import type { MatchReceipt, Player } from "../core/types.js";
import { ContractPrizePoolAdapter } from "../integrations/ContractPrizePoolAdapter.js";
import { ZeroGStorageAdapter } from "../integrations/ZeroGStorageAdapter.js";

loadEnv({ path: resolve(process.cwd(), ".env") });

export interface RealInferenceConnect4HarnessResult {
  matchId: string;
  outcome: "winner" | "draw";
  winner?: string;
  movesCompleted: number;
  receipt: MatchReceipt;
  coordinator: MatchCoordinator;
  runner: AgentRunner;
}

export async function runRealInferenceConnect4E2E(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RealInferenceConnect4HarnessResult> {
  validateRealInferenceConnect4Env(env);

  const players: Player[] = [
    {
      id: "agent_alpha",
      name: "Alpha",
      walletAddress: env.AGENT_ALPHA_WALLET_ADDRESS ?? "",
      agentKind: "0g-serving",
    },
    {
      id: "agent_beta",
      name: "Beta",
      walletAddress: env.AGENT_BETA_WALLET_ADDRESS ?? "",
      agentKind: "0g-serving",
    },
  ];

  const prizePool = new ContractPrizePoolAdapter({
    rpcUrl: env.EVM_RPC_URL ?? "",
    ownerPrivateKey: env.EVM_PRIVATE_KEY ?? "",
    prizePoolAddress: env.PRIZE_POOL_ADDRESS ?? "",
    stakeWei: env.MATCH_STAKE_WEI ?? "",
    rulesHash: env.CONNECT4_RULEBOOK_HASH ?? "",
    expectedChainId: BigInt(env.EVM_CHAIN_ID ?? "16602"),
    privateKeysByRef: {
      AGENT_ALPHA_PRIVATE_KEY: env.AGENT_ALPHA_PRIVATE_KEY,
      AGENT_BETA_PRIVATE_KEY: env.AGENT_BETA_PRIVATE_KEY,
    },
  });
  const coordinator = new MatchCoordinator({
    engines: [new Connect4()],
    archive: new ZeroGStorageAdapter({
      evmRpcUrl: env.ZERO_G_STORAGE_RPC ?? env.EVM_RPC_URL ?? "",
      privateKey: env.ZERO_G_STORAGE_PRIVATE_KEY ?? "",
      indexerRpc:
        env.ZERO_G_STORAGE_INDEXER_RPC ?? "https://indexer-storage-testnet-turbo.0g.ai",
    }),
    prizePool,
    rulebook: {
      rulesHash: env.CONNECT4_RULEBOOK_HASH ?? "",
      rulesUrl: env.CONNECT4_RULEBOOK_URL ?? "",
      rulesVersion: env.CONNECT4_RULEBOOK_VERSION ?? "",
    },
    idFactory: () => `match_connect4_real_${Date.now().toString(36)}`,
  });
  const provider = new ZeroGServingProvider({
    rpcUrl: env.ZERO_G_EVM_RPC_URL ?? env.EVM_RPC_URL ?? "https://evmrpc-testnet.0g.ai",
    providerAddress: env.ZERO_G_PROVIDER_ADDRESS,
    model: env.ZERO_G_SERVING_MODEL,
    autoFundBufferMultiplier: Number(env.ZERO_G_AUTO_FUND_BUFFER_MULTIPLIER ?? 1),
    requestSpacingMs: Number(env.ZERO_G_INFERENCE_REQUEST_SPACING_MS ?? 7000),
    temperature: Number(env.ZERO_G_INFERENCE_TEMPERATURE ?? 0.35),
    topP: Number(env.ZERO_G_INFERENCE_TOP_P ?? 0.9),
    privateKeysByRef: {
      AGENT_ALPHA_PRIVATE_KEY: env.AGENT_ALPHA_PRIVATE_KEY ?? "",
      AGENT_BETA_PRIVATE_KEY: env.AGENT_BETA_PRIVATE_KEY ?? "",
    },
  });
  const validatorRunner = new AgentRunner(coordinator, []);
  const agents = players.map((player, index) =>
    createConnect4Agent({
      playerId: player.id,
      name: index === 0 ? "Alpha" : "Beta",
      walletAddress: player.walletAddress,
      privateKeyRef: index === 0 ? "AGENT_ALPHA_PRIVATE_KEY" : "AGENT_BETA_PRIVATE_KEY",
      provider,
      allowMockFallback: false,
      validatorForSchema: (schema) => validatorRunner.validatorForSchema(schema),
    }),
  );
  const runner = new AgentRunner(coordinator, agents, {
    turnDelayInMs: Number(env.REAL_INFERENCE_TURN_DELAY_MS ?? 7_000),
  });

  const match = coordinator.createMatch("connect4", players);
  await prizePool.createAndFund({
    matchId: match.id,
    players,
    rulesHash: env.CONNECT4_RULEBOOK_HASH ?? "",
  });
  await coordinator.activateMatch(match.id);

  const result = await runner.run(match.id);
  const paidMatch = coordinator.getMatch(match.id);
  const receipt = result.receipt ?? coordinator.getReceipt(match.id);
  if (!paidMatch || paidMatch.status !== "paid" || !receipt) {
    throw new Error("Real inference Connect4 E2E did not produce a paid receipt");
  }
  if (receipt.gameId !== "connect4") {
    throw new Error(`Real inference Connect4 E2E produced wrong game receipt: ${receipt.gameId}`);
  }
  if (receipt.rulesHash !== env.CONNECT4_RULEBOOK_HASH) {
    throw new Error("Real inference Connect4 E2E receipt rulesHash does not match CONNECT4_RULEBOOK_HASH");
  }
  if (receipt.agentInference.some((summary) => summary.mode !== "0g-serving")) {
    throw new Error("Real inference Connect4 E2E used a non-0G inference mode");
  }
  if (receipt.agentInference.some((summary) => summary.fallbackTurns !== 0)) {
    throw new Error("Real inference Connect4 E2E recorded fallback turns");
  }
  if (receipt.outcome === "winner" && !receipt.payoutTxHash) {
    throw new Error("Real inference Connect4 winner match is missing payout transaction hash");
  }
  if (receipt.outcome === "draw" && (!receipt.refundTxHashes || receipt.refundTxHashes.length !== players.length)) {
    throw new Error("Real inference Connect4 draw match is missing refund transaction hashes");
  }

  return {
    matchId: match.id,
    outcome: receipt.outcome,
    winner: receipt.winner,
    movesCompleted: coordinator.getHistory(match.id).length,
    receipt,
    coordinator,
    runner,
  };
}

function validateRealInferenceConnect4Env(env: NodeJS.ProcessEnv): void {
  if (env.AGENT_INFERENCE_MODE !== "0g-serving") {
    throw new Error("Real inference Connect4 E2E requires AGENT_INFERENCE_MODE=0g-serving");
  }
  if (env.ARCHIVE_MODE !== "0g") {
    throw new Error("Real inference Connect4 E2E requires ARCHIVE_MODE=0g");
  }
  if ((env.PAYOUT_MODE ?? "contract") !== "contract") {
    throw new Error("Real inference Connect4 E2E requires PAYOUT_MODE=contract");
  }
  const missing = [
    "EVM_RPC_URL",
    "EVM_PRIVATE_KEY",
    "PRIZE_POOL_ADDRESS",
    "MATCH_STAKE_WEI",
    "ZERO_G_STORAGE_PRIVATE_KEY",
    "AGENT_ALPHA_WALLET_ADDRESS",
    "AGENT_ALPHA_PRIVATE_KEY",
    "AGENT_BETA_WALLET_ADDRESS",
    "AGENT_BETA_PRIVATE_KEY",
    "CONNECT4_RULEBOOK_HASH",
    "CONNECT4_RULEBOOK_URL",
    "CONNECT4_RULEBOOK_VERSION",
  ].filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Real inference Connect4 E2E requires live env: missing ${missing.join(", ")}`);
  }
}
