import { ethers } from "ethers";
import type { Player } from "../core/types.js";
import type { PrizePoolAdapter, PrizePoolSnapshot } from "./PrizePoolAdapter.js";

const PRIZE_POOL_ABI = [
  "function createMatch(bytes32 matchId,address[] players,uint256 requiredStake,bytes32 rulesHash)",
  "function fund(bytes32 matchId) payable",
  "function isFullyFunded(bytes32 matchId) view returns (bool)",
  "function fundedAmount(bytes32 matchId,address player) view returns (uint256)",
  "function matches(bytes32 matchId) view returns (uint256 requiredStake,uint256 totalStake,bool paid,bool refunded,bytes32 storageHash,address winner,bytes32 rulesHash)",
  "function payout(bytes32 matchId,address winner,bytes32 storageHash)",
  "function refundDraw(bytes32 matchId,bytes32 storageHash)",
];

export interface ContractPrizePoolAdapterOptions {
  rpcUrl: string;
  ownerPrivateKey: string;
  prizePoolAddress: string;
  stakeWei: string;
  rulesHash: string;
  expectedChainId?: bigint;
  privateKeysByRef: Record<string, string | undefined>;
}

export class ContractPrizePoolAdapter implements PrizePoolAdapter {
  readonly mode = "contract" as const;
  private readonly provider: ethers.JsonRpcProvider;
  private readonly owner: ethers.Wallet;
  private readonly contract: ethers.Contract;
  private readonly fundingTxHashes = new Map<string, PrizePoolSnapshot["fundingTxHashes"]>();
  private readonly playersByMatch = new Map<string, Array<{ playerId?: string; walletAddress: string }>>();
  private readonly creationTxHashes = new Map<string, string>();
  private readonly rulesHashByMatch = new Map<string, string>();

  constructor(private readonly options: ContractPrizePoolAdapterOptions) {
    if (!options.rpcUrl) {
      throw new Error("EVM_RPC_URL is required for PAYOUT_MODE=contract");
    }
    if (!options.ownerPrivateKey) {
      throw new Error("EVM_PRIVATE_KEY is required for PAYOUT_MODE=contract");
    }
    if (!options.prizePoolAddress) {
      throw new Error("PRIZE_POOL_ADDRESS is required for PAYOUT_MODE=contract");
    }
    if (!options.stakeWei) {
      throw new Error("MATCH_STAKE_WEI is required for PAYOUT_MODE=contract");
    }
    if (!options.rulesHash) {
      throw new Error("A rulebook hash is required for PAYOUT_MODE=contract");
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(options.rulesHash)) {
      throw new Error("SOVEREIGN_BLUFF_RULEBOOK_HASH must be a bytes32 hex value");
    }
    this.provider = new ethers.JsonRpcProvider(options.rpcUrl);
    this.owner = new ethers.Wallet(options.ownerPrivateKey, this.provider);
    this.contract = new ethers.Contract(options.prizePoolAddress, PRIZE_POOL_ABI, this.owner);
  }

  async assertExpectedChain(): Promise<void> {
    const network = await this.provider.getNetwork();
    const expected = this.options.expectedChainId ?? 16602n;
    if (network.chainId !== expected) {
      throw new Error(`Expected 0G Galileo chain ID ${expected}, got ${network.chainId}`);
    }
  }

  async createAndFund(input: {
    matchId: string;
    players: Player[];
    rulesHash?: string;
  }): Promise<PrizePoolSnapshot> {
    await this.assertExpectedChain();
    await this.createPool({
      matchId: input.matchId,
      players: input.players.map((player) => ({ walletAddress: player.walletAddress })),
      stakeWei: this.options.stakeWei,
      rulesHash: input.rulesHash ?? this.options.rulesHash,
    });
    this.playersByMatch.set(
      input.matchId,
      input.players.map((player) => ({ playerId: player.id, walletAddress: player.walletAddress })),
    );
    for (const player of input.players) {
      await this.fundPool({
        matchId: input.matchId,
        playerId: player.id,
        walletAddress: player.walletAddress,
        privateKeyRef: privateKeyRefForWallet(player.walletAddress, this.options.privateKeysByRef),
        amountWei: this.options.stakeWei,
      });
    }
    const pool = await this.getPool({ matchId: input.matchId });
    if (!pool.fullyFunded) {
      throw new Error("PrizePool funding completed but contract is not fully funded");
    }
    return pool;
  }

  async createPool(input: {
    matchId: string;
    players: Array<{ walletAddress: string }>;
    stakeWei: string;
    rulesHash?: string;
  }): Promise<{ txHash: string }> {
    const matchKey = matchIdToBytes32(input.matchId);
    const wallets = input.players.map((player) => ethers.getAddress(player.walletAddress));
    const rulesHash = input.rulesHash ?? this.options.rulesHash;
    if (!/^0x[0-9a-fA-F]{64}$/.test(rulesHash)) {
      throw new Error("createPool rulesHash must be a bytes32 hex value");
    }
    const tx = await this.contract.createMatch(matchKey, wallets, input.stakeWei, rulesHash);
    await tx.wait();
    this.creationTxHashes.set(input.matchId, tx.hash);
    this.rulesHashByMatch.set(input.matchId, rulesHash);
    this.playersByMatch.set(input.matchId, wallets.map((walletAddress) => ({ walletAddress })));
    return { txHash: tx.hash };
  }

  async fundPool(input: {
    matchId: string;
    playerId: string;
    walletAddress: string;
    privateKeyRef: string;
    amountWei: string;
  }): Promise<{ txHash: string }> {
    if (input.amountWei !== this.options.stakeWei) {
      throw new Error("Funding amount must exactly equal MATCH_STAKE_WEI");
    }
    const privateKey = this.options.privateKeysByRef[input.privateKeyRef];
    if (!privateKey) {
      throw new Error(`${input.privateKeyRef} is required to fund ${input.walletAddress}`);
    }
    const signer = new ethers.Wallet(privateKey, this.provider);
    if (ethers.getAddress(await signer.getAddress()) !== ethers.getAddress(input.walletAddress)) {
      throw new Error(`${input.privateKeyRef} does not match ${input.walletAddress}`);
    }
    const contract = this.contract.connect(signer) as ethers.Contract;
    const tx = await contract.fund(matchIdToBytes32(input.matchId), {
      value: input.amountWei,
    });
    await tx.wait();
    const existing = this.fundingTxHashes.get(input.matchId) ?? [];
    existing.push({
      playerId: input.playerId,
      walletAddress: input.walletAddress,
      txHash: tx.hash,
      amountWei: input.amountWei,
    });
    this.fundingTxHashes.set(input.matchId, existing);
    return { txHash: tx.hash };
  }

  async getPool(input: { matchId: string }): Promise<PrizePoolSnapshot> {
    const matchKey = matchIdToBytes32(input.matchId);
    const matchData = await this.contract.matches(matchKey);
    if (matchData.requiredStake === 0n && matchData.rulesHash === ethers.ZeroHash) {
      throw new Error(`PrizePool match pool does not exist for ${input.matchId}`);
    }
    const fullyFunded = await this.contract.isFullyFunded(matchKey);
    const expectedRulesHash = this.rulesHashByMatch.get(input.matchId) ?? this.options.rulesHash;
    if (matchData.rulesHash !== expectedRulesHash) {
      throw new Error(
        `PrizePool rulesHash mismatch: expected ${expectedRulesHash}, got ${matchData.rulesHash}`,
      );
    }
    return {
      prizePoolAddress: this.options.prizePoolAddress,
      stakeWei: matchData.requiredStake.toString(),
      totalPoolWei: matchData.totalStake.toString(),
      rulesHash: matchData.rulesHash,
      fullyFunded,
      paid: matchData.paid || matchData.refunded,
      fundingTxHashes: this.fundingTxHashes.get(input.matchId) ?? [],
      poolCreationTxHash: this.creationTxHashes.get(input.matchId),
    };
  }

  async payoutWinner(input: {
    matchId: string;
    winnerWallet: string;
    archiveHash: string;
  }): Promise<{ txHash: string; amountWei: string; status: "paid" | "failed"; error?: string }> {
    const pool = await this.getPool({ matchId: input.matchId });
    if (!pool.fullyFunded) {
      return { txHash: "", amountWei: "0", status: "failed", error: "pool is not fully funded" };
    }
    try {
      const tx = await this.contract.payout(
        matchIdToBytes32(input.matchId),
        ethers.getAddress(input.winnerWallet),
        archiveHashToBytes32(input.archiveHash),
      );
      await tx.wait();
      return { txHash: tx.hash, amountWei: pool.totalPoolWei, status: "paid" };
    } catch (error) {
      return {
        txHash: "",
        amountWei: "0",
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
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
    const pool = await this.getPool({ matchId: input.matchId });
    if (!pool.fullyFunded) {
      return { txHashes: [], amountWei: "0", status: "failed", error: "pool is not fully funded" };
    }
    try {
      const tx = await this.contract.refundDraw(
        matchIdToBytes32(input.matchId),
        archiveHashToBytes32(input.archiveHash),
      );
      await tx.wait();
      const players = this.playersByMatch.get(input.matchId) ?? [];
      const amountWei = pool.stakeWei;
      const txHashes = players.map((player, index) => ({
        playerId: player.playerId ?? `player_${index + 1}`,
        walletAddress: player.walletAddress,
        txHash: tx.hash,
        amountWei,
      }));
      return { txHashes, amountWei, status: "refunded" };
    } catch (error) {
      return {
        txHashes: [],
        amountWei: "0",
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export function matchIdToBytes32(matchId: string): string {
  return ethers.id(matchId);
}

export function archiveHashToBytes32(hash: string): string {
  if (/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return hash;
  }
  return ethers.keccak256(ethers.toUtf8Bytes(hash));
}

export function privateKeyRefForWallet(
  walletAddress: string,
  privateKeysByRef: Record<string, string | undefined>,
): string {
  const expected = ethers.getAddress(walletAddress);
  for (const [ref, privateKey] of Object.entries(privateKeysByRef)) {
    if (!privateKey) {
      continue;
    }
    const signer = new ethers.Wallet(privateKey);
    if (ethers.getAddress(signer.address) === expected) {
      return ref;
    }
  }
  throw new Error(`No configured private key matches ${walletAddress}`);
}
