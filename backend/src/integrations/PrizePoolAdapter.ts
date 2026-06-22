import type { FundingTxReceipt } from "../core/types.js";

export interface PrizePoolSnapshot {
  prizePoolAddress: string;
  stakeWei: string;
  totalPoolWei: string;
  rulesHash: string;
  fullyFunded: boolean;
  paid: boolean;
  fundingTxHashes: FundingTxReceipt[];
  poolCreationTxHash?: string;
}

export interface PrizePoolAdapter {
  readonly mode: "contract";
  createPool(input: {
    matchId: string;
    players: Array<{ walletAddress: string }>;
    stakeWei: string;
    rulesHash?: string;
  }): Promise<{ txHash: string }>;
  fundPool(input: {
    matchId: string;
    playerId: string;
    walletAddress: string;
    privateKeyRef: string;
    amountWei: string;
  }): Promise<{ txHash: string }>;
  getPool(input: { matchId: string }): Promise<PrizePoolSnapshot>;
  payoutWinner(input: {
    matchId: string;
    winnerWallet: string;
    archiveHash: string;
  }): Promise<{
    txHash: string;
    amountWei: string;
    status: "paid" | "failed";
    error?: string;
  }>;
}
