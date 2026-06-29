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
  refundDraw(input: {
    matchId: string;
    archiveHash: string;
  }): Promise<{
    txHashes: FundingTxReceipt[];
    amountWei: string;
    status: "refunded" | "failed";
    error?: string;
  }>;
}

export interface MatchCoordinatorOptions {
  engines: IGameEngine[];
  archive: ArchiveGateway;
  prizePool: PrizePoolGateway;
  rulebook: RulebookCommitment | Record<string, RulebookCommitment>;
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
  private readonly rulebooks = new Map<string, RulebookCommitment>();
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
    this.loadRulebooks(options.rulebook);
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
      timeoutCounts: Object.fromEntries(players.map((player) => [player.id, 0])),
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

  failMatch(matchId: string, reason: string): Match {
    const match = this.requireMatch(matchId);
    match.status = "failed";
    match.state.status = "finished";
    match.failureReason = reason;
    return this.store.update(match);
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
    match.turnStartedAt = this.now().toISOString();
    match.timeoutCounts = this.ensureTimeoutCounts(match);
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
      turnStartedAt: match.turnStartedAt,
      turnExpiresAt: match.turnStartedAt
        ? new Date(Date.parse(match.turnStartedAt) + this.timeoutInMs).toISOString()
        : undefined,
      timeoutsUsed: match.timeoutCounts?.[playerId] ?? 0,
      receipt: match.receipt,
    };
  }

  async processTimeouts(matchId: string): Promise<Match> {
    const match = this.requireMatch(matchId);
    if (match.status !== "active") {
      return match;
    }

    const startedAt = match.turnStartedAt ? Date.parse(match.turnStartedAt) : Number.NaN;
    if (!Number.isFinite(startedAt)) {
      match.turnStartedAt = this.now().toISOString();
      return this.store.update(match);
    }
    if (this.now().getTime() - startedAt < this.timeoutInMs) {
      return match;
    }

    const timedOutPlayer = match.players.find((player) => this.isPlayerTurn(match, player.id))?.id;
    if (!timedOutPlayer) {
      match.turnStartedAt = this.now().toISOString();
      return this.store.update(match);
    }

    match.timeoutCounts = this.ensureTimeoutCounts(match);
    if ((match.timeoutCounts[timedOutPlayer] ?? 0) >= 1) {
      return this.applyTimeoutForfeit(match, timedOutPlayer);
    }
    return this.applyTimeoutDefaultMove(match, timedOutPlayer);
  }

  async processLiveTimeouts(): Promise<void> {
    const activeIds = this.store
      .list()
      .filter((match) => match.status === "active")
      .map((match) => match.id);
    for (const matchId of activeIds) {
      await this.processTimeouts(matchId);
    }
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
      if (termination.outcome === "draw") {
        match.state.publicContext = "draw";
      }
      this.store.update(match);
      const receipt = await this.finalizeMatch(match.id);
      return { ok: true, match: this.requireMatch(match.id), receipt };
    }

    match.turnStartedAt = this.now().toISOString();
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
    const outcome = match.state.winner ? "winner" : match.state.publicContext === "draw" ? "draw" : undefined;
    if (!outcome) {
      throw new Error("Cannot finalize match without winner or draw outcome");
    }
    const rulebook = this.requireRulebook(match.gameId);

    const archiveResult = await this.archive.archiveMatch({
      matchId,
      gameId: match.gameId,
      rulesHash: rulebook.rulesHash,
      rulesUrl: rulebook.rulesUrl,
      rulesVersion: rulebook.rulesVersion,
      history: this.store.getHistory(matchId),
      finalState: match.state,
    });
    if (!archiveResult.archiveHash) {
      throw new Error("Archive adapter did not return archive hash");
    }

    match.status = "archived";
    this.store.update(match);

    const pool = await this.prizePool.getPool({ matchId });
    const settlement =
      outcome === "winner"
        ? await this.settleWinner(match, archiveResult.archiveHash)
        : await this.settleDraw(match, archiveResult.archiveHash);
    const receipt = this.buildReceipt(match, archiveResult, settlement, pool, rulebook, outcome);
    match.status = "paid";
    match.receipt = receipt;
    this.store.storeReceipt(matchId, receipt);
    return receipt;
  }

  private buildReceipt(
    match: Match,
    archiveResult: { archiveHash: string; url?: string },
    settlement:
      | { kind: "winner"; txHash: string; amountWei: string }
      | { kind: "draw"; txHashes: FundingTxReceipt[]; amountWei: string },
    pool: PrizePoolStatus,
    rulebook: RulebookCommitment,
    outcome: "winner" | "draw",
  ): MatchReceipt {
    if (!archiveResult.archiveHash) {
      throw new Error("Cannot create receipt without archive hash");
    }
    if (!rulebook.rulesHash) {
      throw new Error("Cannot create receipt without rulebook hash");
    }
    if (!rulebook.rulesUrl) {
      throw new Error("Cannot create receipt without rulebook URL");
    }
    if (!rulebook.rulesVersion) {
      throw new Error("Cannot create receipt without rulebook version");
    }
    if (pool.rulesHash !== rulebook.rulesHash) {
      throw new Error("Cannot create receipt because prize pool rulesHash does not match configured rulebook hash");
    }
    if (!pool.fundingTxHashes.length) {
      throw new Error("Cannot create receipt without funding transaction hashes");
    }
    if (settlement.kind === "winner" && !settlement.amountWei) {
      throw new Error("Cannot create receipt without payout amount");
    }
    if (settlement.kind === "winner" && !settlement.txHash) {
      throw new Error("Cannot create receipt without payout transaction hash");
    }
    if (settlement.kind === "draw" && settlement.txHashes.length !== match.players.length) {
      throw new Error("Cannot create draw receipt without refund transaction hashes");
    }
    if (!pool.prizePoolAddress || !pool.stakeWei || !pool.totalPoolWei) {
      throw new Error("Cannot create receipt without prize pool accounting fields");
    }
    if (outcome === "winner" && !match.state.winner) {
      throw new Error("Cannot create receipt without winner");
    }

    const winner = match.state.winner ? this.requirePlayer(match, match.state.winner) : undefined;
    return {
      matchId: match.id,
      gameId: match.gameId,
      rulesHash: rulebook.rulesHash,
      rulesUrl: rulebook.rulesUrl,
      rulesVersion: rulebook.rulesVersion,
      outcome,
      winner: match.state.winner,
      archiveHash: archiveResult.archiveHash,
      archiveUrl: archiveResult.url,
      payoutTxHash: settlement.kind === "winner" ? settlement.txHash : undefined,
      refundTxHashes: settlement.kind === "draw" ? settlement.txHashes : undefined,
      prizePoolAddress: pool.prizePoolAddress,
      stakeWei: pool.stakeWei,
      totalPoolWei: pool.totalPoolWei,
      fundingTxHashes: pool.fundingTxHashes,
      winnerWalletAddress: winner?.walletAddress,
      payoutAmountWei: settlement.kind === "winner" ? settlement.amountWei : undefined,
      refundAmountWei: settlement.kind === "draw" ? settlement.amountWei : undefined,
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

  private requireRulebook(gameId: string): RulebookCommitment {
    const rulebook = this.rulebooks.get(gameId) ?? this.rulebooks.get("*");
    if (!rulebook) {
      throw new Error(`Missing rulebook commitment for ${gameId}`);
    }
    return rulebook;
  }

  private loadRulebooks(input: RulebookCommitment | Record<string, RulebookCommitment>): void {
    if (isRulebookCommitment(input)) {
      this.validateRulebook("*", input);
      this.rulebooks.set("*", input);
      return;
    }
    for (const [gameId, rulebook] of Object.entries(input)) {
      this.validateRulebook(gameId, rulebook);
      this.rulebooks.set(gameId, rulebook);
    }
  }

  private validateRulebook(gameId: string, rulebook: RulebookCommitment): void {
    if (!rulebook.rulesHash) {
      throw new Error(`${gameId} rulebook hash is required`);
    }
    if (!rulebook.rulesUrl) {
      throw new Error(`${gameId} rulebook URL is required`);
    }
    if (!rulebook.rulesVersion) {
      throw new Error(`${gameId} rulebook version is required`);
    }
  }

  private async settleWinner(
    match: Match,
    archiveHash: string,
  ): Promise<{ kind: "winner"; txHash: string; amountWei: string }> {
    if (!match.state.winner) {
      throw new Error("Cannot payout winner without winner");
    }
    const winner = this.requirePlayer(match, match.state.winner);
    const payout = await this.prizePool.payoutWinner({
      matchId: match.id,
      winnerWallet: winner.walletAddress,
      archiveHash,
    });
    if (payout.status !== "paid") {
      match.status = "failed";
      match.failureReason = payout.error ?? "Payout failed";
      this.store.update(match);
      throw new Error(match.failureReason);
    }
    return { kind: "winner", txHash: payout.txHash, amountWei: payout.amountWei };
  }

  private async settleDraw(
    match: Match,
    archiveHash: string,
  ): Promise<{ kind: "draw"; txHashes: FundingTxReceipt[]; amountWei: string }> {
    const refund = await this.prizePool.refundDraw({
      matchId: match.id,
      archiveHash,
    });
    if (refund.status !== "refunded") {
      match.status = "failed";
      match.failureReason = refund.error ?? "Draw refund failed";
      this.store.update(match);
      throw new Error(match.failureReason);
    }
    return { kind: "draw", txHashes: refund.txHashes, amountWei: refund.amountWei };
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

  private async applyTimeoutDefaultMove(match: Match, playerId: PlayerId): Promise<Match> {
    const engine = this.requireEngine(match.gameId);
    if (!engine.getDefaultMove) {
      return this.applyTimeoutForfeit(match, playerId);
    }
    const action = engine.getDefaultMove(match.state, playerId);
    const validation = engine.validateMove(match.state, action, playerId);
    if (!validation.ok) {
      throw new Error(`Timeout default move is invalid: ${validation.error ?? "Invalid move"}`);
    }

    match.timeoutCounts = this.ensureTimeoutCounts(match);
    match.timeoutCounts[playerId] = (match.timeoutCounts[playerId] ?? 0) + 1;

    const publicStateBefore = engine.getPublicState(match.state, playerId);
    const nextState = engine.applyMove(match.state, action, playerId);
    const publicStateAfter = engine.getPublicState(nextState, playerId);
    const turn: TurnRecord = {
      matchId: match.id,
      round: match.state.round,
      phase: "timeout-default",
      playerId,
      action,
      publicStateBefore,
      publicStateAfter,
      timestamp: this.now().toISOString(),
    };

    match.state = nextState;
    this.store.appendTurn(match.id, turn);
    const termination = engine.checkTermination(match.state);
    if (termination.finished) {
      match.status = "finished";
      match.state.status = "finished";
      match.state.winner = termination.winner;
      if (termination.outcome === "draw") {
        match.state.publicContext = "draw";
      }
      this.store.update(match);
      await this.finalizeMatch(match.id);
      return this.requireMatch(match.id);
    }

    match.turnStartedAt = this.now().toISOString();
    return this.store.update(match);
  }

  private async applyTimeoutForfeit(match: Match, timedOutPlayer: PlayerId): Promise<Match> {
    const engine = this.requireEngine(match.gameId);
    if (!engine.applyForfeit) {
      throw new Error(`Game ${match.gameId} does not support timeout forfeit`);
    }

    const publicStateBefore = engine.getPublicState(match.state, timedOutPlayer);
    const nextState = engine.applyForfeit(match.state, timedOutPlayer);
    const publicStateAfter = engine.getPublicState(nextState, timedOutPlayer);
    match.timeoutCounts = this.ensureTimeoutCounts(match);
    match.timeoutCounts[timedOutPlayer] = (match.timeoutCounts[timedOutPlayer] ?? 0) + 1;
    match.state = nextState;
    match.status = "finished";
    match.state.status = "finished";

    this.store.appendTurn(match.id, {
      matchId: match.id,
      round: match.state.round,
      phase: "timeout-forfeit",
      playerId: timedOutPlayer,
      action: { reason: "timeout-forfeit" },
      publicStateBefore,
      publicStateAfter,
      timestamp: this.now().toISOString(),
    });

    this.store.update(match);
    await this.finalizeMatch(match.id);
    return this.requireMatch(match.id);
  }

  private ensureTimeoutCounts(match: Match): Record<PlayerId, number> {
    return Object.fromEntries(
      match.players.map((player) => [player.id, match.timeoutCounts?.[player.id] ?? 0]),
    );
  }

  private isPlayerTurn(match: Match, playerId: PlayerId): boolean {
    if (match.status !== "active") {
      return false;
    }

    const board = match.state.board as {
      phase?: string;
      currentPlayer?: string;
      broadcastsPerPlayer?: number;
      broadcasts?: Record<string, unknown>;
      broadcastCounts?: Record<string, number>;
      bids?: Record<string, unknown>;
    };

    if (match.state.currentPlayer) {
      return match.state.currentPlayer === playerId;
    }
    if (board.currentPlayer) {
      return board.currentPlayer === playerId;
    }

    if (board.phase === "broadcast") {
      return (board.broadcastCounts?.[playerId] ?? 0) < (board.broadcastsPerPlayer ?? 1);
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

function isRulebookCommitment(
  input: RulebookCommitment | Record<string, RulebookCommitment>,
): input is RulebookCommitment {
  return typeof (input as RulebookCommitment).rulesHash === "string";
}
