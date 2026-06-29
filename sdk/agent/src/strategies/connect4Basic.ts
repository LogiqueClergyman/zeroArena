import type { AgentDecision, AgentStrategy } from "../types.js";

export class Connect4BasicStrategy implements AgentStrategy {
  async decide(input: {
    publicState: unknown;
    playerId: string;
  }): Promise<AgentDecision> {
    return this.fallback({
      publicState: input.publicState,
      playerId: input.playerId,
      reason: "deterministic Connect4 strategy",
    });
  }

  fallback(input: { publicState: unknown; playerId: string; reason: string }): AgentDecision {
    return {
      action: chooseMove(input.publicState, input.playerId),
      source: "deterministic",
      fallbackReason: input.reason,
    };
  }
}

export function chooseMove(publicState: unknown, playerId: string): { column: number } {
  const state = asRecord(publicState);
  const board = normalizeBoard(state.board);
  const valid = validColumns(state);
  if (valid.length === 0) {
    return { column: 0 };
  }
  const players = Array.isArray(state.players)
    ? state.players.filter((value): value is string => typeof value === "string")
    : [];
  const opponent = players.find((candidate) => candidate !== playerId);
  const winning = tacticalColumn(board, valid, playerId);
  if (winning !== undefined) {
    return { column: winning };
  }
  const blocking = opponent ? tacticalColumn(board, valid, opponent) : undefined;
  if (blocking !== undefined) {
    return { column: blocking };
  }
  const safe = opponent
    ? valid.filter((column) => !letsOpponentWin(board, column, playerId, opponent))
    : valid;
  const choices = safe.length ? safe : valid;
  return { column: choices.sort((a, b) => Math.abs(a - 3) - Math.abs(b - 3))[0] };
}

function tacticalColumn(
  board: Array<Array<string | null>>,
  valid: number[],
  playerId: string,
): number | undefined {
  for (const column of valid) {
    const row = lowestOpenRow(board, column);
    if (row === undefined) {
      continue;
    }
    const next = board.map((line) => [...line]);
    next[row][column] = playerId;
    if (hasConnect4(next, row, column, playerId)) {
      return column;
    }
  }
  return undefined;
}

function letsOpponentWin(
  board: Array<Array<string | null>>,
  column: number,
  playerId: string,
  opponent: string,
): boolean {
  const row = lowestOpenRow(board, column);
  if (row === undefined) {
    return true;
  }
  const next = board.map((line) => [...line]);
  next[row][column] = playerId;
  return validColumnsFromBoard(next).some((opponentColumn) => {
    const opponentRow = lowestOpenRow(next, opponentColumn);
    if (opponentRow === undefined) {
      return false;
    }
    const after = next.map((line) => [...line]);
    after[opponentRow][opponentColumn] = opponent;
    return hasConnect4(after, opponentRow, opponentColumn, opponent);
  });
}

function hasConnect4(
  board: Array<Array<string | null>>,
  row: number,
  column: number,
  playerId: string,
): boolean {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ] as const;
  return directions.some(([rowDelta, columnDelta]) => {
    const count =
      1 +
      countDirection(board, row, column, playerId, rowDelta, columnDelta) +
      countDirection(board, row, column, playerId, -rowDelta, -columnDelta);
    return count >= 4;
  });
}

function countDirection(
  board: Array<Array<string | null>>,
  row: number,
  column: number,
  playerId: string,
  rowDelta: number,
  columnDelta: number,
): number {
  let count = 0;
  let nextRow = row + rowDelta;
  let nextColumn = column + columnDelta;
  while (board[nextRow]?.[nextColumn] === playerId) {
    count += 1;
    nextRow += rowDelta;
    nextColumn += columnDelta;
  }
  return count;
}

function lowestOpenRow(board: Array<Array<string | null>>, column: number): number | undefined {
  for (let row = board.length - 1; row >= 0; row -= 1) {
    if (board[row]?.[column] === null) {
      return row;
    }
  }
  return undefined;
}

function validColumns(state: Record<string, unknown>): number[] {
  if (Array.isArray(state.validColumns)) {
    const explicit = state.validColumns.filter((column): column is number => typeof column === "number");
    if (explicit.length) {
      return explicit;
    }
  }
  return validColumnsFromBoard(normalizeBoard(state.board));
}

function validColumnsFromBoard(board: Array<Array<string | null>>): number[] {
  const columns = Math.max(0, ...board.map((row) => row.length));
  return Array.from({ length: columns }, (_, column) => column).filter(
    (column) => board[0]?.[column] === null,
  );
}

function normalizeBoard(value: unknown): Array<Array<string | null>> {
  return Array.isArray(value)
    ? value.map((row) =>
        Array.isArray(row)
          ? row.map((cell) => (typeof cell === "string" ? cell : null))
          : [],
      )
    : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
