import type { Player } from "../core/types.js";
import type { PrizePoolAdapter, PrizePoolSnapshot } from "./PrizePoolAdapter.js";

interface LocalPool {
  matchId: string;
  players: Player[];
  rulesHash: string;
  paid: boolean;
}

export class LocalDevPrizePoolAdapter implements PrizePoolAdapter {
  readonly mode = "contract" as const;
  private readonly pools = new Map<string, LocalPool>();

  constructor(
    private readonly options: {
      stakeWei?: string;
      prizePoolAddress?: string;
    } = {},
  ) {}

  async createAndFund(input: {
    matchId: string;
    players: Player[];
    rulesHash?: string;
  }): Promise<PrizePoolSnapshot> {
    await this.createPool({
      matchId: input.matchId,
      players: input.players.map((player) => ({ walletAddress: player.walletAddress })),
      stakeWei: this.stakeWei(),
      rulesHash: input.rulesHash,
    });
    this.pools.set(input.matchId, {
      matchId: input.matchId,
      players: input.players,
      rulesHash: input.rulesHash ?? localDevRulesHash(),
      paid: false,
    });
    return this.getPool({ matchId: input.matchId });
  }

  async createPool(input: {
    matchId: string;
    players: Array<{ walletAddress: string }>;
    stakeWei: string;
    rulesHash?: string;
  }): Promise<{ txHash: string }> {
    if (!input.rulesHash) {
      throw new Error("Local dev prize pool requires a rulebook hash");
    }
    const existing = this.pools.get(input.matchId);
    if (!existing) {
      this.pools.set(input.matchId, {
        matchId: input.matchId,
        players: input.players.map((player, index) => ({
          id: `player_${index + 1}`,
          name: `Player ${index + 1}`,
          walletAddress: player.walletAddress,
          agentKind: "mock",
        })),
        rulesHash: input.rulesHash,
        paid: false,
      });
    }
    return { txHash: `local-dev-not-onchain-create-${input.matchId}` };
  }

  async fundPool(): Promise<{ txHash: string }> {
    return { txHash: "local-dev-not-onchain-funded-by-lobby" };
  }

  async getPool(input: { matchId: string }): Promise<PrizePoolSnapshot> {
    const pool = this.pools.get(input.matchId);
    if (!pool) {
      throw new Error(`Local dev prize pool does not exist for ${input.matchId}`);
    }
    const stakeWei = this.stakeWei();
    return {
      prizePoolAddress: this.options.prizePoolAddress ?? "local-dev-prize-pool-not-onchain",
      stakeWei,
      totalPoolWei: String(BigInt(stakeWei) * BigInt(pool.players.length)),
      rulesHash: pool.rulesHash,
      fullyFunded: true,
      paid: pool.paid,
      poolCreationTxHash: `local-dev-not-onchain-create-${input.matchId}`,
      fundingTxHashes: pool.players.map((player) => ({
        playerId: player.id,
        walletAddress: player.walletAddress,
        txHash: `local-dev-not-onchain-fund-${input.matchId}-${player.id}`,
        amountWei: stakeWei,
      })),
    };
  }

  async payoutWinner(input: {
    matchId: string;
    winnerWallet: string;
    archiveHash: string;
  }): Promise<{ txHash: string; amountWei: string; status: "paid" | "failed"; error?: string }> {
    const pool = this.pools.get(input.matchId);
    if (!pool) {
      return { txHash: "", amountWei: "0", status: "failed", error: "local pool missing" };
    }
    pool.paid = true;
    return {
      txHash: `local-dev-not-onchain-payout-${input.matchId}`,
      amountWei: String(BigInt(this.stakeWei()) * BigInt(pool.players.length)),
      status: "paid",
    };
  }

  async refundDraw(input: {
    matchId: string;
    archiveHash: string;
  }): Promise<{
    txHashes: PrizePoolSnapshot["fundingTxHashes"];
    amountWei: string;
    status: "refunded" | "failed";
    error?: string;
  }> {
    const pool = this.pools.get(input.matchId);
    if (!pool) {
      return { txHashes: [], amountWei: "0", status: "failed", error: "local pool missing" };
    }
    pool.paid = true;
    const amountWei = this.stakeWei();
    return {
      amountWei,
      status: "refunded",
      txHashes: pool.players.map((player) => ({
        playerId: player.id,
        walletAddress: player.walletAddress,
        txHash: `local-dev-not-onchain-refund-${input.matchId}`,
        amountWei,
      })),
    };
  }

  private stakeWei(): string {
    return this.options.stakeWei && /^\d+$/.test(this.options.stakeWei)
      ? this.options.stakeWei
      : "1000";
  }
}

export function localDevRulesHash(): string {
  return "0x1111111111111111111111111111111111111111111111111111111111111111";
}
