import { AgentRunner } from "../agents/AgentRunner.js";
import { createAggressiveAgent, createCautiousAgent } from "../agents/demoAgents.js";
import { ZeroGServingProvider } from "../agents/providers/ZeroGServingProvider.js";
import { MatchCoordinator } from "../core/MatchCoordinator.js";
import type { MatchReceipt, Player } from "../core/types.js";
import { SovereignBluff } from "../games/SovereignBluff.js";
import { ContractPrizePoolAdapter } from "../integrations/ContractPrizePoolAdapter.js";
import { ZeroGStorageAdapter } from "../integrations/ZeroGStorageAdapter.js";
import { validateStartup } from "../server.js";

export interface RealInferenceHarnessResult {
  matchId: string;
  winner: string;
  roundsCompleted: number;
  receipt: MatchReceipt;
  coordinator: MatchCoordinator;
  runner: AgentRunner;
}

export async function runRealInferenceSovereignBluffE2E(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RealInferenceHarnessResult> {
  validateRealInferenceEnv(env);

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
    rulesHash: env.SOVEREIGN_BLUFF_RULEBOOK_HASH ?? "",
    expectedChainId: BigInt(env.EVM_CHAIN_ID ?? "16602"),
    privateKeysByRef: {
      AGENT_ALPHA_PRIVATE_KEY: env.AGENT_ALPHA_PRIVATE_KEY,
      AGENT_BETA_PRIVATE_KEY: env.AGENT_BETA_PRIVATE_KEY,
    },
  });
  const coordinator = new MatchCoordinator({
    engines: [new SovereignBluff()],
    archive: new ZeroGStorageAdapter({
      evmRpcUrl: env.ZERO_G_STORAGE_RPC ?? env.EVM_RPC_URL ?? "",
      privateKey: env.ZERO_G_STORAGE_PRIVATE_KEY ?? "",
      indexerRpc:
        env.ZERO_G_STORAGE_INDEXER_RPC ?? "https://indexer-storage-testnet-turbo.0g.ai",
    }),
    prizePool,
    rulebook: {
      rulesHash: env.SOVEREIGN_BLUFF_RULEBOOK_HASH ?? "",
      rulesUrl: env.SOVEREIGN_BLUFF_RULEBOOK_URL ?? "",
      rulesVersion: env.SOVEREIGN_BLUFF_RULEBOOK_VERSION ?? "",
    },
    idFactory: () => `match_real_${Date.now().toString(36)}`,
  });
  const provider = new ZeroGServingProvider({
    rpcUrl: env.ZERO_G_EVM_RPC_URL ?? env.EVM_RPC_URL ?? "https://evmrpc-testnet.0g.ai",
    providerAddress: env.ZERO_G_PROVIDER_ADDRESS,
    model: env.ZERO_G_SERVING_MODEL,
    autoFundBufferMultiplier: Number(env.ZERO_G_AUTO_FUND_BUFFER_MULTIPLIER ?? 1),
    requestSpacingMs: Number(env.ZERO_G_INFERENCE_REQUEST_SPACING_MS ?? 7000),
    temperature: Number(env.ZERO_G_INFERENCE_TEMPERATURE ?? 0.85),
    topP: Number(env.ZERO_G_INFERENCE_TOP_P ?? 0.9),
    privateKeysByRef: {
      AGENT_ALPHA_PRIVATE_KEY: env.AGENT_ALPHA_PRIVATE_KEY ?? "",
      AGENT_BETA_PRIVATE_KEY: env.AGENT_BETA_PRIVATE_KEY ?? "",
    },
  });
  const validatorRunner = new AgentRunner(coordinator, []);
  const agents = [
    createCautiousAgent({
      playerId: players[0].id,
      walletAddress: players[0].walletAddress,
      privateKeyRef: "AGENT_ALPHA_PRIVATE_KEY",
      provider,
      allowMockFallback: false,
      validatorForSchema: (schema) => validatorRunner.validatorForSchema(schema),
    }),
    createAggressiveAgent({
      playerId: players[1].id,
      walletAddress: players[1].walletAddress,
      privateKeyRef: "AGENT_BETA_PRIVATE_KEY",
      provider,
      allowMockFallback: false,
      validatorForSchema: (schema) => validatorRunner.validatorForSchema(schema),
    }),
  ];
  const runner = new AgentRunner(coordinator, agents, {
    turnDelayInMs: Number(env.REAL_INFERENCE_TURN_DELAY_MS ?? 7_000),
  });

  const match = coordinator.createMatch("sovereign-bluff", players);
  await prizePool.createAndFund({ matchId: match.id, players });
  await coordinator.activateMatch(match.id);

  const result = await runner.run(match.id);
  const paidMatch = coordinator.getMatch(match.id);
  const receipt = result.receipt ?? coordinator.getReceipt(match.id);
  if (!paidMatch || paidMatch.status !== "paid" || !receipt) {
    throw new Error("Real inference Sovereign Bluff E2E did not produce a paid receipt");
  }
  if (receipt.agentInference.some((summary) => summary.mode !== "0g-serving")) {
    throw new Error("Real inference E2E used a non-0G inference mode");
  }
  if (receipt.agentInference.some((summary) => summary.fallbackTurns !== 0)) {
    throw new Error("Real inference E2E recorded fallback turns");
  }

  return {
    matchId: match.id,
    winner: receipt.winner,
    roundsCompleted: paidMatch.state.round,
    receipt,
    coordinator,
    runner,
  };
}

function validateRealInferenceEnv(env: NodeJS.ProcessEnv): void {
  validateStartup({
    ...env,
    LOCAL_DEV_ALLOW_MOCKS: "false",
    AGENT_INFERENCE_MODE: "0g-serving",
    ARCHIVE_MODE: "0g",
    PAYOUT_MODE: "contract",
  });
  if (env.AGENT_INFERENCE_MODE !== "0g-serving") {
    throw new Error("Real inference E2E requires AGENT_INFERENCE_MODE=0g-serving");
  }
  if (env.ARCHIVE_MODE !== "0g") {
    throw new Error("Real inference E2E requires ARCHIVE_MODE=0g");
  }
  if ((env.PAYOUT_MODE ?? "contract") !== "contract") {
    throw new Error("Real inference E2E requires PAYOUT_MODE=contract");
  }
}
