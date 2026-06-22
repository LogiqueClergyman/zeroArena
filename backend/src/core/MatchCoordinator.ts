import type { IGameEngine } from "../games/IGameEngine.js";
import { MatchStore } from "./MatchStore.js";
import type {
  AgentInferenceSummary,
  AgentStateResponse,
  FundingTxReceipt,
  Match,
  MatchReceipt,
  MatchStatus,
  MatchSummary,
  Player,
  PlayerId,
  SubmitMoveResponse,
  TurnRecord,
} from "./types.js";

export interface ArchiveGateway {
  readonly mode: "mock" | "0g";
  archiveMatch(input: {
    matchId: string;
    gameId: string;
    rulesHash: string;
    rulesUrl: string;
    rulesVersion: string;
    history: TurnRecord[];
    finalState: unknown;
  }): Promise<{ archiveHash: string; url?: string }>;
}

export interface PrizePoolStatus {
  prizePoolAddress: string;
  stakeWei: string;
  totalPoolWei: string;
  rulesHash: string;
  fullyFunded: boolean;
  paid: boolean;
  fundingTxHashes: FundingTxReceipt[];
  poolCreationTxHash?: string;
}

export interface PrizePoolGateway {
  readonly mode: "contract";
  getPool(input: { matchId: string }): Promise<PrizePoolStatus>;
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

export interface MatchCoordinatorOptions {
  engines: IGameEngine[];
  archive: ArchiveGateway;
  prizePool: PrizePoolGateway;
  rulebook: RulebookCommitment;
  store?: MatchStore;
  timeoutInMs?: number;
  idFactory?: () => string;
  now?: () => Date;
}

export interface RulebookCommitment {
  rulesHash: string;
  rulesUrl: string;
  rulesVersion: string;
}

export class MatchCoordinator {
  private readonly engines = new Map<string, IGameEngine>();
  private readonly archive: ArchiveGateway;
  private readonly prizePool: PrizePoolGateway;
  private readonly rulebook: RulebookCommitment;
  private readonly store: MatchStore;
  private readonly timeoutInMs: number;
  private readonly idFactory: () => string;
  private readonly now: () => Date;
  private readonly inference = new Map<string, Map<PlayerId, AgentInferenceSummary>>();

  constructor(options: MatchCoordinatorOptions) {
    for (const engine of options.engines) {
      this.engines.set(engine.id, engine);
    }
    this.archive = options.archive;
    this.prizePool = options.prizePool;
    this.rulebook = options.rulebook;
    if (!this.rulebook.rulesHash) {
      throw new Error("Sovereign Bluff rulebook hash is required");
    }
    if (!this.rulebook.rulesUrl) {
      throw new Error("Sovereign Bluff rulebook URL is required");
    }
    if (!this.rulebook.rulesVersion) {
      throw new Error("Sovereign Bluff rulebook version is required");
    }
    this.store = options.store ?? new MatchStore();
    this.timeoutInMs = options.timeoutInMs ?? 30_000;
    this.idFactory =
      options.idFactory ??
      (() => `match_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
    this.now = options.now ?? (() => new Date());
  }

  createMatch(gameId: string, players: Player[]): Match {
    const engine = this.requireEngine(gameId);
    if (players.length < engine.minPlayers || players.length > engine.maxPlayers) {
      throw new Error(`${engine.name} requires ${engine.minPlayers} players`);
    }

    const now = this.now().toISOString();
    const state = engine.initState(players.map((player) => player.id));
    const match: Match = {
      id: this.idFactory(),
      gameId,
      players,
      status: "waiting",
      state,
      createdAt: now,
      updatedAt: now,
    };

    this.inference.set(
      match.id,
      new Map(
        players.map((player) => [
          player.id,
          {
            playerId: player.id,
            walletAddress: player.walletAddress,
            mode: player.agentKind === "0g-serving" ? "0g-serving" : "mock fallback",
            turns: 0,
            fallbackTurns: player.agentKind === "mock" ? 0 : 0,
          },
        ]),
      ),
    );

    return this.store.create(match);
  }

  getMatch(matchId: string): Match | undefined {
    return this.store.get(matchId);
  }

  async activateMatch(matchId: string): Promise<Match> {
    const match = this.requireMatch(matchId);
    if (match.status !== "waiting") {
      throw new Error("Only waiting matches can be activated");
    }

    const pool = await this.prizePool.getPool({ matchId });
    if (!pool.fullyFunded) {
      throw new Error("Prize pool is not fully funded");
    }
    if (!pool.prizePoolAddress || !pool.stakeWei || !pool.totalPoolWei) {
      throw new Error("Prize pool status is missing required fields");
    }
    if (pool.fundingTxHashes.length !== match.players.length) {
      throw new Error("Prize pool funding transactions are incomplete");
    }

    match.status = "active";
    match.state.status = "active";
    return this.store.update(match);
  }

  getAgentState(matchId: string, playerId: string): AgentStateResponse {
    const match = this.requireMatch(matchId);
    const engine = this.requireEngine(match.gameId);
    if (!match.players.some((player) => player.id === playerId)) {
      throw new Error("Unknown player");
    }

    return {
      matchId: match.id,
      gameId: match.gameId,
      status: match.status,
      yourTurn: this.isPlayerTurn(match, playerId),
      playerId,
      publicState: engine.getPublicState(match.state, playerId),
      actionSchema: engine.actionSchema,
      round: match.state.round,
      timeoutInMs: this.timeoutInMs,
      receipt: match.receipt,
    };
  }

  async submitMove(
    matchId: string,
    playerId: string,
    action: unknown,
  ): Promise<SubmitMoveResponse> {
    const match = this.requireMatch(matchId);
    const engine = this.requireEngine(match.gameId);
    if (match.status !== "active") {
      return { ok: false, match, error: "Match is not active" };
    }
    if (!this.isPlayerTurn(match, playerId)) {
      return { ok: false, match, error: "It is not this player's turn" };
    }

    const validation = engine.validateMove(match.state, action, playerId);
    if (!validation.ok) {
      return { ok: false, match, error: validation.error ?? "Invalid move" };
    }

    const publicStateBefore = engine.getPublicState(match.state, playerId);
    const nextState = engine.applyMove(match.state, action, playerId);
    const publicStateAfter = engine.getPublicState(nextState, playerId);
    const phase =
      typeof action === "object" &&
      action !== null &&
      "phase" in action &&
      typeof action.phase === "string"
        ? action.phase
        : "unknown";

    const turn: TurnRecord = {
      matchId,
      round: match.state.round,
      phase,
      playerId,
      action,
      publicStateBefore,
      publicStateAfter,
      timestamp: this.now().toISOString(),
    };

    match.state = nextState;
    this.store.appendTurn(matchId, turn);
    const termination = engine.checkTermination(match.state);
    if (termination.finished) {
      match.status = "finished";
      match.state.status = "finished";
      match.state.winner = termination.winner;
      this.store.update(match);
      const receipt = await this.finalizeMatch(match.id);
      return { ok: true, match: this.requireMatch(match.id), receipt };
    }

    this.store.update(match);
    return { ok: true, match };
  }

  getHistory(matchId: string): TurnRecord[] {
    return this.store.getHistory(matchId);
  }

  listLiveMatches(): MatchSummary[] {
    return this.store
      .list()
      .filter((match) => match.status === "waiting" || match.status === "active")
      .map((match) => ({
        matchId: match.id,
        gameId: match.gameId,
        status: match.status,
        round: match.state.round,
        players: match.players,
        winner: match.state.winner,
      }));
  }

  getReceipt(matchId: string): MatchReceipt | undefined {
    return this.store.getReceipt(matchId);
  }

  private async finalizeMatch(matchId: string): Promise<MatchReceipt> {
    const match = this.requireMatch(matchId);
    if (match.receipt) {
      return match.receipt;
    }
    if (!match.state.winner) {
      throw new Error("Cannot finalize match without winner");
    }

    const archiveResult = await this.archive.archiveMatch({
      matchId,
      gameId: match.gameId,
      rulesHash: this.rulebook.rulesHash,
      rulesUrl: this.rulebook.rulesUrl,
      rulesVersion: this.rulebook.rulesVersion,
      history: this.store.getHistory(matchId),
      finalState: match.state,
    });
    if (!archiveResult.archiveHash) {
      throw new Error("Archive adapter did not return archive hash");
    }

    match.status = "archived";
    this.store.update(match);

    const winner = this.requirePlayer(match, match.state.winner);
    const payout = await this.prizePool.payoutWinner({
      matchId,
      winnerWallet: winner.walletAddress,
      archiveHash: archiveResult.archiveHash,
    });
    if (payout.status !== "paid") {
      match.status = "failed";
      match.failureReason = payout.error ?? "Payout failed";
      this.store.update(match);
      throw new Error(match.failureReason);
    }

    const pool = await this.prizePool.getPool({ matchId });
    const receipt = this.buildReceipt(match, archiveResult, payout, pool);
    match.status = "paid";
    match.receipt = receipt;
    this.store.storeReceipt(matchId, receipt);
    return receipt;
  }

  private buildReceipt(
    match: Match,
    archiveResult: { archiveHash: string; url?: string },
    payout: { txHash: string; amountWei: string },
    pool: PrizePoolStatus,
  ): MatchReceipt {
    if (!archiveResult.archiveHash) {
      throw new Error("Cannot create receipt without archive hash");
    }
    if (!this.rulebook.rulesHash) {
      throw new Error("Cannot create receipt without rulebook hash");
    }
    if (!this.rulebook.rulesUrl) {
      throw new Error("Cannot create receipt without rulebook URL");
    }
    if (!this.rulebook.rulesVersion) {
      throw new Error("Cannot create receipt without rulebook version");
    }
    if (pool.rulesHash !== this.rulebook.rulesHash) {
      throw new Error("Cannot create receipt because prize pool rulesHash does not match configured rulebook hash");
    }
    if (!pool.fundingTxHashes.length) {
      throw new Error("Cannot create receipt without funding transaction hashes");
    }
    if (!payout.amountWei) {
      throw new Error("Cannot create receipt without payout amount");
    }
    if (!payout.txHash) {
      throw new Error("Cannot create receipt without payout transaction hash");
    }
    if (!pool.prizePoolAddress || !pool.stakeWei || !pool.totalPoolWei) {
      throw new Error("Cannot create receipt without prize pool accounting fields");
    }
    if (!match.state.winner) {
      throw new Error("Cannot create receipt without winner");
    }

    const winner = this.requirePlayer(match, match.state.winner);
    return {
      matchId: match.id,
      gameId: match.gameId,
      rulesHash: this.rulebook.rulesHash,
      rulesUrl: this.rulebook.rulesUrl,
      rulesVersion: this.rulebook.rulesVersion,
      winner: match.state.winner,
      archiveHash: archiveResult.archiveHash,
      archiveUrl: archiveResult.url,
      payoutTxHash: payout.txHash,
      prizePoolAddress: pool.prizePoolAddress,
      stakeWei: pool.stakeWei,
      totalPoolWei: pool.totalPoolWei,
      fundingTxHashes: pool.fundingTxHashes,
      winnerWalletAddress: winner.walletAddress,
      payoutAmountWei: payout.amountWei,
      payoutMode: this.prizePool.mode,
      archiveMode: this.archive.mode,
      agentInference: [...(this.inference.get(match.id)?.values() ?? [])],
      completedAt: this.now().toISOString(),
    };
  }

  private requireEngine(gameId: string): IGameEngine {
    const engine = this.engines.get(gameId);
    if (!engine) {
      throw new Error(`Unknown game: ${gameId}`);
    }
    return engine;
  }

  private requireMatch(matchId: string): Match {
    const match = this.store.get(matchId);
    if (!match) {
      throw new Error(`Unknown match: ${matchId}`);
    }
    return match;
  }

  private requirePlayer(match: Match, playerId: PlayerId): Player {
    const player = match.players.find((candidate) => candidate.id === playerId);
    if (!player) {
      throw new Error(`Unknown player: ${playerId}`);
    }
    return player;
  }

  private isPlayerTurn(match: Match, playerId: PlayerId): boolean {
    if (match.status !== "active") {
      return false;
    }

    const board = match.state.board as {
      phase?: string;
      broadcasts?: Record<string, unknown>;
      bids?: Record<string, unknown>;
    };

    if (board.phase === "broadcast") {
      return !Object.hasOwn(board.broadcasts ?? {}, playerId);
    }
    if (board.phase === "bid") {
      return !Object.hasOwn(board.bids ?? {}, playerId);
    }
    return false;
  }

  recordAgentInferenceTurn(
    matchId: string,
    playerId: PlayerId,
    mode: "0g-serving" | "mock fallback",
  ): void {
    this.recordInferenceTurn(matchId, playerId, mode);
  }

  async getPrizePoolStatus(matchId: string): Promise<PrizePoolStatus> {
    return this.prizePool.getPool({ matchId });
  }

  private recordInferenceTurn(
    matchId: string,
    playerId: PlayerId,
    mode: "0g-serving" | "mock fallback",
  ): void {
    const summary = this.inference.get(matchId)?.get(playerId);
    if (!summary) {
      return;
    }
    summary.turns += 1;
    if (mode === "mock fallback") {
      summary.fallbackTurns += 1;
    }
    if (summary.mode !== "0g-serving") {
      summary.mode = mode;
    }
  }
}

export function isPaidStatus(status: MatchStatus): boolean {
  return status === "paid";
}
