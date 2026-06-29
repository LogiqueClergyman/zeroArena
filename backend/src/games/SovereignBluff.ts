import type { GameState, PlayerId, ValidationResult } from "../core/types.js";
import type { IGameEngine, UIRenderPayload } from "./IGameEngine.js";

export const sovereignBluffActionSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        phase: { const: "broadcast" },
        message: { type: "string", maxLength: 280 },
      },
      required: ["phase", "message"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        phase: { const: "bid" },
        amount: { type: "number", minimum: 0 },
      },
      required: ["phase", "amount"],
      additionalProperties: false,
    },
  ],
} as const;

export type SovereignBluffPhase = "broadcast" | "bid" | "reveal" | "finished";

export interface RoundSummary {
  round: number;
  treasury: number;
  bids: Record<PlayerId, number>;
  winner?: PlayerId;
  balancesAfter: Record<PlayerId, number>;
  messages: Record<PlayerId, string>;
  roundMessages: Record<PlayerId, string[]>;
}

interface MessageRecord {
  playerId: PlayerId;
  round: number;
  text: string;
  timestamp: string;
}

export interface SovereignBluffBoard {
  totalRounds: number;
  broadcastsPerPlayer: number;
  phase: SovereignBluffPhase;
  treasuries: number[];
  balances: Record<PlayerId, number>;
  broadcasts: Record<PlayerId, string>;
  broadcastCounts: Record<PlayerId, number>;
  bids: Record<PlayerId, number>;
  messages: MessageRecord[];
  history: RoundSummary[];
  forfeitFailures: Record<PlayerId, number>;
  forfeitWinner?: PlayerId;
}

type SovereignBluffMove =
  | { phase: "broadcast"; message: string }
  | { phase: "bid"; amount: number };

const TOTAL_ROUNDS = 5;
const BROADCASTS_PER_PLAYER = 2;
const STARTING_BALANCE = 100;
const TREASURIES = [64, 18, 91, 37, 76] as const;
const MAX_FAILURES_BEFORE_FORFEIT = 3;

function boardOf(state: GameState): SovereignBluffBoard {
  return state.board as SovereignBluffBoard;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneState(state: GameState): GameState {
  return structuredClone(state) as GameState;
}

export class SovereignBluff implements IGameEngine {
  readonly id = "sovereign-bluff";
  readonly name = "Sovereign Bluff";
  readonly minPlayers = 2;
  readonly maxPlayers = 2;
  readonly actionSchema = sovereignBluffActionSchema;

  initState(players: PlayerId[]): GameState {
    if (players.length !== 2) {
      throw new Error("Sovereign Bluff requires exactly 2 players");
    }

    return {
      gameId: this.id,
      players,
      round: 1,
      status: "waiting",
      board: {
        totalRounds: TOTAL_ROUNDS,
        broadcastsPerPlayer: BROADCASTS_PER_PLAYER,
        phase: "broadcast",
        treasuries: [...TREASURIES],
        balances: Object.fromEntries(
          players.map((player) => [player, STARTING_BALANCE]),
        ),
        broadcasts: {},
        broadcastCounts: Object.fromEntries(players.map((player) => [player, 0])),
        bids: {},
        messages: [],
        history: [],
        forfeitFailures: Object.fromEntries(players.map((player) => [player, 0])),
      } satisfies SovereignBluffBoard,
    };
  }

  getPublicState(state: GameState, forPlayer: PlayerId): unknown {
    const board = boardOf(state);
    const opponent = state.players.find((player) => player !== forPlayer);
    if (!opponent) {
      throw new Error(`Unknown player ${forPlayer}`);
    }

    return {
      game: this.id,
      round: state.round,
      totalRounds: board.totalRounds,
      phase: board.phase,
      currentTreasury: board.treasuries[state.round - 1] ?? 0,
      myBalance: board.balances[forPlayer],
      opponentBalance: board.balances[opponent],
      myLastMessage: board.broadcasts[forPlayer],
      opponentLastMessage: board.broadcasts[opponent],
      broadcastTurnsPerPlayer: BROADCASTS_PER_PLAYER,
      myBroadcastCount: board.broadcastCounts[forPlayer] ?? 0,
      opponentBroadcastCount: board.broadcastCounts[opponent] ?? 0,
      currentRoundConversation: board.messages
        .filter((message) => message.round === state.round)
        .map((message) => ({
          playerId: message.playerId,
          speaker: message.playerId === forPlayer ? "me" : "opponent",
          text: message.text,
        })),
      previousRounds: board.history.map((round) => ({
        round: round.round,
        treasury: round.treasury,
        myMessage: round.messages[forPlayer],
        opponentMessage: round.messages[opponent],
        myMessages: round.roundMessages[forPlayer] ?? [],
        opponentMessages: round.roundMessages[opponent] ?? [],
        myBid: round.bids[forPlayer],
        opponentBid: round.bids[opponent],
        winner: round.winner,
        myBalanceAfter: round.balancesAfter[forPlayer],
        opponentBalanceAfter: round.balancesAfter[opponent],
      })),
      conversation: board.messages.map((message) => ({
        round: message.round,
        playerId: message.playerId,
        speaker: message.playerId === forPlayer ? "me" : "opponent",
        text: message.text,
      })),
    };
  }

  validateMove(
    state: GameState,
    move: unknown,
    player: PlayerId,
  ): ValidationResult {
    if (state.status !== "active") {
      return { ok: false, error: "Game is not active" };
    }
    if (!state.players.includes(player)) {
      return { ok: false, error: "Unknown player" };
    }
    if (!isRecord(move)) {
      return { ok: false, error: "Move must be an object" };
    }

    const board = boardOf(state);
    if (board.phase === "finished") {
      return { ok: false, error: "Game is already finished" };
    }

    if (move.phase === "broadcast") {
      return this.validateBroadcast(board, move, player);
    }

    if (move.phase === "bid") {
      return this.validateBid(board, move, player);
    }

    return { ok: false, error: "Invalid phase" };
  }

  applyMove(state: GameState, move: unknown, player: PlayerId): GameState {
    const validation = this.validateMove(state, move, player);
    if (!validation.ok) {
      throw new Error(validation.error ?? "Invalid move");
    }

    const next = cloneState(state);
    const board = boardOf(next);
    const typedMove = move as SovereignBluffMove;

    if (typedMove.phase === "broadcast") {
      board.broadcasts[player] = typedMove.message;
      board.broadcastCounts[player] = (board.broadcastCounts[player] ?? 0) + 1;
      board.messages.push({
        playerId: player,
        round: next.round,
        text: typedMove.message,
        timestamp: new Date().toISOString(),
      });

      if (next.players.every((id) => (board.broadcastCounts[id] ?? 0) >= BROADCASTS_PER_PLAYER)) {
        board.phase = "bid";
      }
      return next;
    }

    board.bids[player] = typedMove.amount;
    if (next.players.every((id) => Object.hasOwn(board.bids, id))) {
      this.resolveRound(next);
    }
    return next;
  }

  checkTermination(state: GameState) {
    if (state.status === "finished") {
      return {
        finished: true,
        winner: state.winner,
        reason: state.winner ? "winner decided" : "finished without winner",
      };
    }

    const board = boardOf(state);
    if (board.forfeitWinner) {
      return {
        finished: true,
        winner: board.forfeitWinner,
        reason: "forfeit",
      };
    }

    return { finished: false };
  }

  renderForUI(state: GameState): UIRenderPayload {
    const board = boardOf(state);
    const revealed =
      board.phase === "reveal" ||
      board.phase === "finished" ||
      Object.keys(board.bids).length === state.players.length;

    return {
      kind: this.id,
      data: {
        players: state.players.map((id) => ({
          id,
          name: id,
          walletAddress: "",
          balance: board.balances[id],
        })),
        round: state.round,
        totalRounds: board.totalRounds,
        phase: board.phase,
        currentTreasury: board.treasuries[state.round - 1] ?? 0,
        messages: board.messages,
        pendingBids: state.players.map((id) => ({
          playerId: id,
          submitted: Object.hasOwn(board.bids, id),
        })),
        revealedBids: revealed
          ? state.players
              .filter((id) => Object.hasOwn(board.bids, id))
              .map((id) => ({ playerId: id, amount: board.bids[id] }))
          : [],
        history: board.history,
        winner: state.winner,
      },
    };
  }

  applyBidTimeout(state: GameState, player: PlayerId): GameState {
    const board = boardOf(state);
    if (board.phase !== "bid") {
      throw new Error("Timeout fallback is only valid during bid phase");
    }
    return this.applyMove(state, { phase: "bid", amount: 0 }, player);
  }

  getDefaultMove(state: GameState, player: PlayerId): unknown {
    const board = boardOf(state);
    if (board.phase === "broadcast") {
      return { phase: "broadcast", message: "" };
    }
    if (board.phase === "bid") {
      return { phase: "bid", amount: 0 };
    }
    throw new Error(`No Sovereign Bluff timeout move is available during ${board.phase}`);
  }

  applyForfeit(state: GameState, timedOutPlayer: PlayerId): GameState {
    if (!state.players.includes(timedOutPlayer)) {
      throw new Error("Unknown player");
    }
    const winner = state.players.find((id) => id !== timedOutPlayer);
    if (!winner) {
      throw new Error("Missing opponent for timeout forfeit");
    }
    const next = cloneState(state);
    const board = boardOf(next);
    board.phase = "finished";
    board.forfeitWinner = winner;
    next.status = "finished";
    next.winner = winner;
    next.publicContext = { reason: "timeout-forfeit", timedOutPlayer };
    return next;
  }

  recordAgentFailure(state: GameState, player: PlayerId): GameState {
    if (!state.players.includes(player)) {
      throw new Error("Unknown player");
    }

    const next = cloneState(state);
    const board = boardOf(next);
    board.forfeitFailures[player] = (board.forfeitFailures[player] ?? 0) + 1;
    if (board.forfeitFailures[player] >= MAX_FAILURES_BEFORE_FORFEIT) {
      const winner = next.players.find((id) => id !== player);
      board.phase = "finished";
      board.forfeitWinner = winner;
      next.status = "finished";
      next.winner = winner;
    }
    return next;
  }

  private validateBroadcast(
    board: SovereignBluffBoard,
    move: Record<string, unknown>,
    player: PlayerId,
  ): ValidationResult {
    if (board.phase !== "broadcast") {
      return { ok: false, error: "Cannot broadcast during bid phase" };
    }
    if (Object.keys(move).some((key) => !["phase", "message"].includes(key))) {
      return { ok: false, error: "Broadcast has additional properties" };
    }
    if ((board.broadcastCounts[player] ?? 0) >= BROADCASTS_PER_PLAYER) {
      return { ok: false, error: "Player already completed broadcast turns this round" };
    }
    if (typeof move.message !== "string") {
      return { ok: false, error: "Broadcast message must be a string" };
    }
    if (move.message.length > 280) {
      return { ok: false, error: "Broadcast message exceeds 280 characters" };
    }
    return { ok: true };
  }

  private validateBid(
    board: SovereignBluffBoard,
    move: Record<string, unknown>,
    player: PlayerId,
  ): ValidationResult {
    if (board.phase !== "bid") {
      return { ok: false, error: "Cannot bid during broadcast phase" };
    }
    if (Object.keys(move).some((key) => !["phase", "amount"].includes(key))) {
      return { ok: false, error: "Bid has additional properties" };
    }
    if (Object.hasOwn(board.bids, player)) {
      return { ok: false, error: "Player already bid this round" };
    }
    if (
      typeof move.amount !== "number" ||
      !Number.isFinite(move.amount) ||
      !Number.isInteger(move.amount)
    ) {
      return { ok: false, error: "Bid amount must be an integer" };
    }
    if (move.amount < 0) {
      return { ok: false, error: "Bid amount cannot be negative" };
    }
    if (move.amount > board.balances[player]) {
      return { ok: false, error: "Bid amount exceeds balance" };
    }
    return { ok: true };
  }

  private resolveRound(state: GameState): void {
    const board = boardOf(state);
    const [first, second] = state.players;
    const firstBid = board.bids[first];
    const secondBid = board.bids[second];
    const treasury = board.treasuries[state.round - 1];

    board.balances[first] -= firstBid;
    board.balances[second] -= secondBid;

    let winner: PlayerId | undefined;
    if (firstBid > secondBid) {
      winner = first;
      board.balances[first] += treasury;
    } else if (secondBid > firstBid) {
      winner = second;
      board.balances[second] += treasury;
    } else {
      board.balances[first] += treasury / 2;
      board.balances[second] += treasury / 2;
    }

    const roundMessages = Object.fromEntries(
      state.players.map((player) => [
        player,
        board.messages
          .filter((message) => message.round === state.round && message.playerId === player)
          .map((message) => message.text),
      ]),
    ) as Record<PlayerId, string[]>;

    board.history.push({
      round: state.round,
      treasury,
      bids: { ...board.bids },
      winner,
      balancesAfter: { ...board.balances },
      messages: { ...board.broadcasts },
      roundMessages,
    });

    board.broadcasts = {};
    board.broadcastCounts = Object.fromEntries(state.players.map((player) => [player, 0]));
    board.bids = {};

    if (state.round >= board.totalRounds) {
      board.phase = "finished";
      state.status = "finished";
      state.winner = this.calculateFinalWinner(state);
      return;
    }

    state.round += 1;
    board.phase = "broadcast";
  }

  private calculateFinalWinner(state: GameState): PlayerId {
    const board = boardOf(state);
    const [first, second] = state.players;
    const firstBalance = board.balances[first];
    const secondBalance = board.balances[second];
    if (firstBalance > secondBalance) {
      return first;
    }
    if (secondBalance > firstBalance) {
      return second;
    }
    return first;
  }
}
