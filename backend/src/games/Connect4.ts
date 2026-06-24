import type { GameState, PlayerId, ValidationResult } from "../core/types.js";
import type { IGameEngine, UIRenderPayload } from "./IGameEngine.js";

export const connect4ActionSchema = {
  type: "object",
  properties: {
    column: { type: "number", minimum: 0, maximum: 6 },
  },
  required: ["column"],
  additionalProperties: false,
} as const;

export type Connect4Cell = PlayerId | null;

export interface Connect4MoveRecord {
  playerId: PlayerId;
  column: number;
  row: number;
}

export interface Connect4Board {
  rows: number;
  columns: number;
  grid: Connect4Cell[][];
  currentPlayer: PlayerId;
  lastMove?: Connect4MoveRecord;
  winningCells: Array<{ row: number; column: number }>;
  moves: Connect4MoveRecord[];
  outcome?: "winner" | "draw";
}

const ROWS = 6;
const COLUMNS = 7;
const CONNECT = 4;

function boardOf(state: GameState): Connect4Board {
  return state.board as Connect4Board;
}

function cloneState(state: GameState): GameState {
  return structuredClone(state) as GameState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class Connect4 implements IGameEngine {
  readonly id = "connect4";
  readonly name = "Connect4";
  readonly minPlayers = 2;
  readonly maxPlayers = 2;
  readonly actionSchema = connect4ActionSchema;

  initState(players: PlayerId[]): GameState {
    if (players.length !== 2) {
      throw new Error("Connect4 requires exactly 2 players");
    }

    return {
      gameId: this.id,
      players,
      round: 1,
      status: "waiting",
      currentPlayer: players[0],
      board: {
        rows: ROWS,
        columns: COLUMNS,
        grid: Array.from({ length: ROWS }, () => Array.from({ length: COLUMNS }, () => null)),
        currentPlayer: players[0],
        winningCells: [],
        moves: [],
      } satisfies Connect4Board,
    };
  }

  getPublicState(state: GameState, forPlayer: PlayerId): unknown {
    const board = boardOf(state);
    return {
      game: this.id,
      rows: board.rows,
      columns: board.columns,
      board: board.grid,
      players: state.players,
      currentPlayer: board.currentPlayer,
      currentPiece: forPlayer === state.players[0] ? "red" : "yellow",
      validColumns: validColumns(board),
      yourTurn: board.currentPlayer === forPlayer,
      lastMove: board.lastMove,
      winningCells: board.winningCells,
      winner: state.winner,
      outcome: board.outcome,
      moveCount: board.moves.length,
      phase: board.outcome ? "finished" : "drop",
    };
  }

  validateMove(state: GameState, move: unknown, player: PlayerId): ValidationResult {
    if (state.status !== "active") {
      return { ok: false, error: "Game is not active" };
    }
    if (!state.players.includes(player)) {
      return { ok: false, error: "Unknown player" };
    }
    const board = boardOf(state);
    if (board.outcome) {
      return { ok: false, error: "Game is already finished" };
    }
    if (board.currentPlayer !== player) {
      return { ok: false, error: "It is not this player's turn" };
    }
    if (!isRecord(move)) {
      return { ok: false, error: "Move must be an object" };
    }
    if (Object.keys(move).some((key) => key !== "column")) {
      return { ok: false, error: "Move has additional properties" };
    }
    if (typeof move.column !== "number" || !Number.isInteger(move.column)) {
      return { ok: false, error: "Column must be an integer" };
    }
    if (move.column < 0 || move.column >= COLUMNS) {
      return { ok: false, error: "Column is out of bounds" };
    }
    if (board.grid[0][move.column] !== null) {
      return { ok: false, error: "Column is full" };
    }
    return { ok: true };
  }

  applyMove(state: GameState, move: unknown, player: PlayerId): GameState {
    const validation = this.validateMove(state, move, player);
    if (!validation.ok) {
      throw new Error(validation.error ?? "Invalid move");
    }

    const next = cloneState(state);
    const board = boardOf(next);
    const column = (move as { column: number }).column;
    const row = lowestOpenRow(board, column);
    if (row === undefined) {
      throw new Error("Column is full");
    }

    board.grid[row][column] = player;
    board.lastMove = { playerId: player, row, column };
    board.moves.push(board.lastMove);
    const winningCells = findWinningCells(board.grid, row, column, player);
    if (winningCells.length >= CONNECT) {
      board.winningCells = winningCells;
      board.outcome = "winner";
      next.status = "finished";
      next.winner = player;
      return next;
    }
    if (validColumns(board).length === 0) {
      board.outcome = "draw";
      next.status = "finished";
      next.publicContext = "draw";
      return next;
    }

    const nextPlayer = next.players.find((candidate) => candidate !== player);
    if (!nextPlayer) {
      throw new Error("Missing next player");
    }
    board.currentPlayer = nextPlayer;
    next.currentPlayer = nextPlayer;
    next.round = board.moves.length + 1;
    return next;
  }

  checkTermination(state: GameState) {
    const board = boardOf(state);
    if (board.outcome === "winner") {
      return { finished: true, outcome: "winner" as const, winner: state.winner, reason: "four connected" };
    }
    if (board.outcome === "draw") {
      return { finished: true, outcome: "draw" as const, reason: "board full" };
    }
    return { finished: false };
  }

  renderForUI(state: GameState): UIRenderPayload {
    const board = boardOf(state);
    return {
      kind: this.id,
      data: {
        rows: board.rows,
        columns: board.columns,
        board: board.grid,
        currentPlayer: board.currentPlayer,
        lastMove: board.lastMove,
        winningCells: board.winningCells,
        validColumns: validColumns(board),
        moves: board.moves,
        moveCount: board.moves.length,
        outcome: board.outcome,
        winner: state.winner,
      },
    };
  }
}

export function validColumns(board: Connect4Board): number[] {
  return Array.from({ length: board.columns }, (_, column) => column).filter(
    (column) => board.grid[0][column] === null,
  );
}

function lowestOpenRow(board: Connect4Board, column: number): number | undefined {
  for (let row = board.rows - 1; row >= 0; row -= 1) {
    if (board.grid[row][column] === null) {
      return row;
    }
  }
  return undefined;
}

function findWinningCells(
  grid: Connect4Cell[][],
  row: number,
  column: number,
  player: PlayerId,
): Array<{ row: number; column: number }> {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ] as const;

  for (const [rowDelta, columnDelta] of directions) {
    const cells = [
      ...collect(grid, row, column, player, -rowDelta, -columnDelta).reverse(),
      { row, column },
      ...collect(grid, row, column, player, rowDelta, columnDelta),
    ];
    if (cells.length >= CONNECT) {
      return cells.slice(0, CONNECT);
    }
  }
  return [];
}

function collect(
  grid: Connect4Cell[][],
  row: number,
  column: number,
  player: PlayerId,
  rowDelta: number,
  columnDelta: number,
): Array<{ row: number; column: number }> {
  const cells: Array<{ row: number; column: number }> = [];
  let nextRow = row + rowDelta;
  let nextColumn = column + columnDelta;
  while (
    nextRow >= 0 &&
    nextRow < ROWS &&
    nextColumn >= 0 &&
    nextColumn < COLUMNS &&
    grid[nextRow][nextColumn] === player
  ) {
    cells.push({ row: nextRow, column: nextColumn });
    nextRow += rowDelta;
    nextColumn += columnDelta;
  }
  return cells;
}
