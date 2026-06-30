import { randomInt } from "node:crypto";
import type { GameState, IGameEngine, PlayerId, UIRenderPayload, ValidationResult } from "@zeroarena/game-sdk";

export type SignalDuelMove = "rock" | "paper" | "scissors";
export type SignalDuelPhase = "dialogue" | "commit";
export type SignalDuelResult = "player-win" | "tie";

export const signalDuelActionSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        phase: { const: "dialogue" },
        message: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["phase", "message"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        phase: { const: "commit" },
        move: { enum: ["rock", "paper", "scissors"] },
      },
      required: ["phase", "move"],
      additionalProperties: false,
    },
  ],
} as const;

export interface SignalDuelInventory {
  rock: number;
  paper: number;
  scissors: number;
}

export interface SignalDuelDialogueLine {
  round: number;
  turn: number;
  playerId: PlayerId;
  message: string;
}

export interface SignalDuelRoundHistory {
  round: number;
  starter: PlayerId;
  messages: Array<{ playerId: PlayerId; message: string }>;
  moves: Record<PlayerId, SignalDuelMove>;
  winner?: PlayerId;
  result: SignalDuelResult;
  scoresAfter: Record<PlayerId, number>;
}

export interface SignalDuelBoard {
  phase: SignalDuelPhase;
  totalRounds: number;
  dialogueTurnsPerPlayer: number;
  starter: PlayerId;
  dialogueTurnIndex: number;
  dialogueOrder: PlayerId[];
  scores: Record<PlayerId, number>;
  inventories: Record<PlayerId, SignalDuelInventory>;
  committedMoves: Record<PlayerId, SignalDuelMove | undefined>;
  dialogue: SignalDuelDialogueLine[];
  roundHistory: SignalDuelRoundHistory[];
  extraTokens: Record<PlayerId, SignalDuelMove>;
  forfeitWinner?: PlayerId;
}

export interface SignalDuelOptions {
  extraTokens?: Record<PlayerId, SignalDuelMove>;
}

type SignalDuelAction =
  | { phase: "dialogue"; message: string }
  | { phase: "commit"; move: SignalDuelMove };

const MOVES: SignalDuelMove[] = ["rock", "paper", "scissors"];
const TOTAL_ROUNDS = 3;
const DIALOGUE_TURNS_PER_PLAYER = 2;
const MAX_MESSAGE_LENGTH = 200;

export class SignalDuel implements IGameEngine {
  readonly id = "signal-duel";
  readonly name = "Signal Duel";
  readonly minPlayers = 2;
  readonly maxPlayers = 2;
  readonly actionSchema = signalDuelActionSchema;

  constructor(private readonly options: SignalDuelOptions = {}) {}

  initState(players: PlayerId[]): GameState {
    if (players.length !== 2) {
      throw new Error("Signal Duel requires exactly 2 players");
    }
    const [starter, responder] = players;
    const extraTokens = Object.fromEntries(
      players.map((player) => [player, this.options.extraTokens?.[player] ?? randomExtraToken()]),
    ) as Record<PlayerId, SignalDuelMove>;

    return {
      gameId: this.id,
      players,
      round: 1,
      status: "waiting",
      currentPlayer: starter,
      board: {
        phase: "dialogue",
        totalRounds: TOTAL_ROUNDS,
        dialogueTurnsPerPlayer: DIALOGUE_TURNS_PER_PLAYER,
        starter,
        dialogueTurnIndex: 0,
        dialogueOrder: [starter, responder, starter, responder],
        scores: Object.fromEntries(players.map((player) => [player, 0])),
        inventories: Object.fromEntries(players.map((player) => [player, inventoryWithExtra(extraTokens[player])])),
        committedMoves: Object.fromEntries(players.map((player) => [player, undefined])),
        dialogue: [],
        roundHistory: [],
        extraTokens,
      } satisfies SignalDuelBoard,
    };
  }

  getPublicState(state: GameState, forPlayer: PlayerId): unknown {
    const board = boardOf(state);
    assertBoardShape(state);
    const opponent = opponentOf(state, forPlayer);
    const myPlayedMoves = movesPlayedBy(board, forPlayer);
    const opponentPlayedMoves = movesPlayedBy(board, opponent);
    const validMoves = validMovesFor(board, forPlayer);

    return {
      game: this.id,
      phase: board.phase,
      round: state.round,
      totalRounds: board.totalRounds,
      currentPlayer: state.currentPlayer,
      starter: board.starter,
      myPlayerId: forPlayer,
      opponentPlayerId: opponent,
      scores: { ...board.scores },
      myInventory: { ...board.inventories[forPlayer] },
      myPlayedMoves,
      opponentPlayedMoves,
      dialogue: board.dialogue.map((line) => ({ ...line })),
      roundHistory: board.roundHistory.map(cloneRoundHistory),
      validMoves,
      messagesRemainingThisRound: messagesRemaining(board),
      hasCommitted: board.committedMoves[forPlayer] !== undefined,
      opponentCommitted: board.committedMoves[opponent] !== undefined,
    };
  }

  validateMove(state: GameState, move: unknown, player: PlayerId): ValidationResult {
    if (state.status !== "active") {
      return { ok: false, error: "Game is not active" };
    }
    if (!state.players.includes(player)) {
      return { ok: false, error: "Unknown player" };
    }
    const shape = validateBoardShape(state);
    if (!shape.ok) {
      return shape;
    }
    const board = boardOf(state);
    if (board.forfeitWinner) {
      return { ok: false, error: "Game is already finished" };
    }
    if (state.currentPlayer !== player) {
      return { ok: false, error: "It is not this player's turn" };
    }
    if (!isRecord(move)) {
      return { ok: false, error: "Move must be an object" };
    }
    if (move.phase === "dialogue") {
      return this.validateDialogue(board, move);
    }
    if (move.phase === "commit") {
      return this.validateCommit(board, move, player);
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
    const action = move as SignalDuelAction;

    if (action.phase === "dialogue") {
      board.dialogue.push({
        round: next.round,
        turn: board.dialogueTurnIndex + 1,
        playerId: player,
        message: action.message,
      });
      board.dialogueTurnIndex += 1;
      if (board.dialogueTurnIndex >= board.dialogueOrder.length) {
        board.phase = "commit";
        next.currentPlayer = board.starter;
      } else {
        next.currentPlayer = board.dialogueOrder[board.dialogueTurnIndex];
      }
      return next;
    }

    board.committedMoves[player] = action.move;
    const responder = responderOf(next, board.starter);
    if (player === board.starter) {
      next.currentPlayer = responder;
      return next;
    }

    return this.resolveRound(next);
  }

  getDefaultMove(state: GameState, player: PlayerId): unknown {
    const board = boardOf(state);
    if (board.phase === "dialogue") {
      return { phase: "dialogue", message: "No signal." };
    }
    const move = validMovesFor(board, player)[0];
    if (!move) {
      throw new Error("No Signal Duel timeout move is available");
    }
    return { phase: "commit", move };
  }

  applyForfeit(state: GameState, timedOutPlayer: PlayerId): GameState {
    if (!state.players.includes(timedOutPlayer)) {
      throw new Error("Unknown player");
    }
    const winner = opponentOf(state, timedOutPlayer);
    const next = cloneState(state);
    const board = boardOf(next);
    board.forfeitWinner = winner;
    next.status = "finished";
    next.winner = winner;
    next.publicContext = { reason: "timeout-forfeit", timedOutPlayer };
    return next;
  }

  checkTermination(state: GameState) {
    const board = boardOf(state);
    if (board.forfeitWinner) {
      return { finished: true, outcome: "winner" as const, winner: board.forfeitWinner, reason: "forfeit" };
    }
    if (state.status !== "finished") {
      return { finished: false };
    }
    if (state.winner) {
      return { finished: true, outcome: "winner" as const, winner: state.winner, reason: "higher score after 3 rounds" };
    }
    return { finished: true, outcome: "draw" as const, reason: "score tie after 3 rounds" };
  }

  renderForUI(state: GameState): UIRenderPayload {
    assertBoardShape(state);
    const board = boardOf(state);
    return {
      kind: this.id,
      data: {
        phase: board.phase,
        round: state.round,
        totalRounds: board.totalRounds,
        currentPlayer: state.currentPlayer,
        starter: board.starter,
        scores: { ...board.scores },
        players: state.players.map((id) => ({
          id,
          inventory: { ...board.inventories[id] },
          playedMoves: movesPlayedBy(board, id),
          committed: board.committedMoves[id] !== undefined,
        })),
        dialogue: board.dialogue.map((line) => ({ ...line })),
        roundHistory: board.roundHistory.map(cloneRoundHistory),
        validMovesByPlayer: Object.fromEntries(state.players.map((id) => [id, validMovesFor(board, id)])),
        messagesRemainingThisRound: messagesRemaining(board),
        pendingCommits: state.players.map((id) => ({
          playerId: id,
          submitted: board.committedMoves[id] !== undefined,
        })),
        revealedMoves: [],
        lastReveal: board.roundHistory.at(-1),
        winner: state.winner,
        outcome: state.status === "finished" ? (state.winner ? "winner" : "draw") : undefined,
      },
    };
  }

  private validateDialogue(board: SignalDuelBoard, move: Record<string, unknown>): ValidationResult {
    if (board.phase !== "dialogue") {
      return { ok: false, error: "Cannot submit dialogue during commit phase" };
    }
    if (Object.keys(move).some((key) => !["phase", "message"].includes(key))) {
      return { ok: false, error: "Dialogue action has additional properties" };
    }
    if (typeof move.message !== "string") {
      return { ok: false, error: "Dialogue message must be a string" };
    }
    if (move.message.length < 1) {
      return { ok: false, error: "Dialogue message cannot be empty" };
    }
    if (move.message.length > MAX_MESSAGE_LENGTH) {
      return { ok: false, error: "Dialogue message exceeds 200 characters" };
    }
    return { ok: true };
  }

  private validateCommit(board: SignalDuelBoard, move: Record<string, unknown>, player: PlayerId): ValidationResult {
    if (board.phase !== "commit") {
      return { ok: false, error: "Cannot commit during dialogue phase" };
    }
    if (Object.keys(move).some((key) => !["phase", "move"].includes(key))) {
      return { ok: false, error: "Commit action has additional properties" };
    }
    if (!isSignalMove(move.move)) {
      return { ok: false, error: "Commit move must be rock, paper, or scissors" };
    }
    if (board.committedMoves[player] !== undefined) {
      return { ok: false, error: "Player already committed this round" };
    }
    if ((board.inventories[player]?.[move.move] ?? 0) <= 0) {
      return { ok: false, error: "Move is not available in inventory" };
    }
    return { ok: true };
  }

  private resolveRound(state: GameState): GameState {
    const board = boardOf(state);
    const [first, second] = state.players;
    const firstMove = board.committedMoves[first];
    const secondMove = board.committedMoves[second];
    if (!firstMove || !secondMove) {
      throw new Error("Cannot resolve Signal Duel round before both commits");
    }

    board.inventories[first][firstMove] -= 1;
    board.inventories[second][secondMove] -= 1;

    const winner = roundWinner(first, firstMove, second, secondMove);
    if (winner) {
      board.scores[winner] += 1;
    }

    board.roundHistory.push({
      round: state.round,
      starter: board.starter,
      messages: board.dialogue
        .filter((line) => line.round === state.round)
        .map((line) => ({ playerId: line.playerId, message: line.message })),
      moves: { [first]: firstMove, [second]: secondMove },
      winner,
      result: winner ? "player-win" : "tie",
      scoresAfter: { ...board.scores },
    });

    board.committedMoves = Object.fromEntries(state.players.map((player) => [player, undefined]));

    if (state.round >= board.totalRounds) {
      state.status = "finished";
      state.currentPlayer = undefined;
      const [winnerId, loserId] = scoreLeader(state);
      state.winner = winnerId && board.scores[winnerId] > board.scores[loserId] ? winnerId : undefined;
      if (!state.winner) {
        state.publicContext = "draw";
      }
      return state;
    }

    const previousStarter = board.starter;
    const nextStarter = winner ? state.players.find((player) => player !== winner) : responderOf(state, previousStarter);
    if (!nextStarter) {
      throw new Error("Missing next round starter");
    }
    const nextResponder = responderOf(state, nextStarter);
    state.round += 1;
    board.phase = "dialogue";
    board.starter = nextStarter;
    board.dialogueTurnIndex = 0;
    board.dialogueOrder = [nextStarter, nextResponder, nextStarter, nextResponder];
    state.currentPlayer = nextStarter;
    return state;
  }
}

function boardOf(state: GameState): SignalDuelBoard {
  return state.board as SignalDuelBoard;
}

function inventoryWithExtra(extra: SignalDuelMove): SignalDuelInventory {
  return {
    rock: extra === "rock" ? 2 : 1,
    paper: extra === "paper" ? 2 : 1,
    scissors: extra === "scissors" ? 2 : 1,
  };
}

function randomExtraToken(): SignalDuelMove {
  return MOVES[randomInt(MOVES.length)];
}

function roundWinner(
  first: PlayerId,
  firstMove: SignalDuelMove,
  second: PlayerId,
  secondMove: SignalDuelMove,
): PlayerId | undefined {
  if (firstMove === secondMove) {
    return undefined;
  }
  if (
    (firstMove === "rock" && secondMove === "scissors") ||
    (firstMove === "scissors" && secondMove === "paper") ||
    (firstMove === "paper" && secondMove === "rock")
  ) {
    return first;
  }
  return second;
}

function validMovesFor(board: SignalDuelBoard, player: PlayerId): SignalDuelMove[] {
  const inventory = board.inventories[player];
  if (!inventory) {
    return [];
  }
  return MOVES.filter((move) => inventory[move] > 0);
}

function movesPlayedBy(board: SignalDuelBoard, player: PlayerId): SignalDuelMove[] {
  return board.roundHistory.map((round) => round.moves[player]).filter(isSignalMove);
}

function messagesRemaining(board: SignalDuelBoard): Record<PlayerId, number> {
  const counts = Object.fromEntries(Object.keys(board.scores).map((player) => [player, 0])) as Record<PlayerId, number>;
  for (const player of board.dialogueOrder.slice(board.dialogueTurnIndex)) {
    counts[player] = (counts[player] ?? 0) + 1;
  }
  return counts;
}

function responderOf(state: GameState, starter: PlayerId): PlayerId {
  const responder = state.players.find((player) => player !== starter);
  if (!responder) {
    throw new Error("Missing responder");
  }
  return responder;
}

function opponentOf(state: GameState, player: PlayerId): PlayerId {
  const opponent = state.players.find((candidate) => candidate !== player);
  if (!opponent) {
    throw new Error(`Unknown player ${player}`);
  }
  return opponent;
}

function scoreLeader(state: GameState): [PlayerId | undefined, PlayerId] {
  const board = boardOf(state);
  const [first, second] = state.players;
  return board.scores[first] >= board.scores[second] ? [first, second] : [second, first];
}

function cloneState(state: GameState): GameState {
  return structuredClone(state) as GameState;
}

function cloneRoundHistory(round: SignalDuelRoundHistory): SignalDuelRoundHistory {
  return {
    ...round,
    messages: round.messages.map((message) => ({ ...message })),
    moves: { ...round.moves },
    scoresAfter: { ...round.scoresAfter },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSignalMove(value: unknown): value is SignalDuelMove {
  return value === "rock" || value === "paper" || value === "scissors";
}

function validateBoardShape(state: GameState): ValidationResult {
  const board = state.board;
  if (!isRecord(board)) {
    return { ok: false, error: "Unexpected Signal Duel board shape" };
  }
  if (board.phase !== "dialogue" && board.phase !== "commit") {
    return { ok: false, error: "Unexpected Signal Duel board phase" };
  }
  if (!Array.isArray(board.dialogueOrder) || typeof board.dialogueTurnIndex !== "number") {
    return { ok: false, error: "Unexpected Signal Duel dialogue state" };
  }
  if (!isRecord(board.inventories) || !isRecord(board.committedMoves) || !isRecord(board.scores)) {
    return { ok: false, error: "Unexpected Signal Duel private state" };
  }
  for (const player of state.players) {
    if (!isRecord(board.inventories[player])) {
      return { ok: false, error: "Unexpected Signal Duel inventory state" };
    }
  }
  return { ok: true };
}

function assertBoardShape(state: GameState): void {
  const validation = validateBoardShape(state);
  if (!validation.ok) {
    throw new Error(validation.error ?? "Unexpected Signal Duel board shape");
  }
}
