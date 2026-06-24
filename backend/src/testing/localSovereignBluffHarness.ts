import { AgentRunner } from "../agents/AgentRunner.js";
import { createAggressiveAgent, createCautiousAgent } from "../agents/demoAgents.js";
import type { LLMProvider } from "../agents/providers/LLMProvider.js";
import { ScriptedSovereignBluffProvider } from "../agents/providers/ScriptedSovereignBluffProvider.js";
import {
  MatchCoordinator,
  type ArchiveGateway,
  type PrizePoolGateway,
  type PrizePoolStatus,
  type RulebookCommitment,
} from "../core/MatchCoordinator.js";
import type { MatchReceipt, Player } from "../core/types.js";
import { SovereignBluff } from "../games/SovereignBluff.js";

const RULEBOOK: RulebookCommitment = {
  rulesHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
  rulesUrl: "mock://rulebook/sovereign-bluff.v1.json",
  rulesVersion: "1.0.0-test",
};

const PLAYERS: Player[] = [
  {
    id: "agent_alpha",
    name: "Alpha",
    walletAddress: "0x00000000000000000000000000000000000000a1",
    agentKind: "mock",
  },
  {
    id: "agent_beta",
    name: "Beta",
    walletAddress: "0x00000000000000000000000000000000000000b2",
    agentKind: "mock",
  },
];

export interface LocalHarness {
  coordinator: MatchCoordinator;
  runner: AgentRunner;
  players: Player[];
  matchId: string;
}

export interface LocalHarnessResult {
  matchId: string;
  winner: string;
  roundsCompleted: number;
  receipt: MatchReceipt;
  coordinator: MatchCoordinator;
  runner: AgentRunner;
}

export async function createLocalSovereignBluffHarness(
  provider: LLMProvider = new ScriptedSovereignBluffProvider(),
): Promise<LocalHarness> {
  const coordinator = new MatchCoordinator({
    engines: [new SovereignBluff()],
    archive: new LocalArchiveGateway(),
    prizePool: new LocalContractPrizePoolGateway(PLAYERS),
    rulebook: RULEBOOK,
    idFactory: () => "match_local_e2e",
    now: () => new Date("2026-06-23T00:00:00.000Z"),
  });
  const validatorRunner = new AgentRunner(coordinator, []);
  const agents = [
    createCautiousAgent({
      playerId: PLAYERS[0].id,
      walletAddress: PLAYERS[0].walletAddress,
      privateKeyRef: "AGENT_ALPHA_PRIVATE_KEY",
      provider,
      allowMockFallback: true,
      validatorForSchema: (schema) => validatorRunner.validatorForSchema(schema),
    }),
    createAggressiveAgent({
      playerId: PLAYERS[1].id,
      walletAddress: PLAYERS[1].walletAddress,
      privateKeyRef: "AGENT_BETA_PRIVATE_KEY",
      provider,
      allowMockFallback: true,
      validatorForSchema: (schema) => validatorRunner.validatorForSchema(schema),
    }),
  ];
  const runner = new AgentRunner(coordinator, agents);
  const match = coordinator.createMatch("sovereign-bluff", PLAYERS);
  await coordinator.activateMatch(match.id);

  return {
    coordinator,
    runner,
    players: PLAYERS,
    matchId: match.id,
  };
}

export async function runLocalSovereignBluffE2E(
  provider?: LLMProvider,
): Promise<LocalHarnessResult> {
  const harness = await createLocalSovereignBluffHarness(provider);
  const result = await harness.runner.run(harness.matchId);
  const match = harness.coordinator.getMatch(harness.matchId);
  const receipt = result.receipt ?? harness.coordinator.getReceipt(harness.matchId);
  if (!match || !receipt || !receipt.winner) {
    throw new Error("Local Sovereign Bluff E2E did not produce a paid receipt");
  }

  return {
    matchId: harness.matchId,
    winner: receipt.winner,
    roundsCompleted: match.state.round,
    receipt,
    coordinator: harness.coordinator,
    runner: harness.runner,
  };
}

class LocalArchiveGateway implements ArchiveGateway {
  readonly mode = "mock" as const;

  async archiveMatch(): Promise<{ archiveHash: string; url?: string }> {
    return {
      archiveHash: "mock-0g-local-sovereign-bluff-archive",
      url: "mock://archive/match_local_e2e",
    };
  }
}

class LocalContractPrizePoolGateway implements PrizePoolGateway {
  readonly mode = "contract" as const;

  constructor(private readonly players: Player[]) {}

  async getPool(): Promise<PrizePoolStatus> {
    return {
      prizePoolAddress: "0x0000000000000000000000000000000000000abc",
      stakeWei: "1000",
      totalPoolWei: "2000",
      rulesHash: RULEBOOK.rulesHash,
      fullyFunded: true,
      paid: true,
      poolCreationTxHash: "0xpoolcreation",
      fundingTxHashes: this.players.map((player) => ({
        playerId: player.id,
        walletAddress: player.walletAddress,
        txHash: `0xfund${player.id.replace("agent_", "")}`,
        amountWei: "1000",
      })),
    };
  }

  async payoutWinner(): Promise<{
    txHash: string;
    amountWei: string;
    status: "paid";
  }> {
    return {
      txHash: "0xpayoutlocal",
      amountWei: "2000",
      status: "paid",
    };
  }

  async refundDraw(): Promise<{
    txHashes: [];
    amountWei: string;
    status: "refunded";
  }> {
    return {
      txHashes: [],
      amountWei: "1000",
      status: "refunded",
    };
  }
}
