import type { ValidateFunction } from "ajv";
import type { LLMProvider } from "./providers/LLMProvider.js";
import type { AgentDecision, AgentStrategy, AgentTurnLog } from "./demoAgents.js";

export interface Connect4AgentOptions {
  playerId: string;
  name: string;
  walletAddress: string;
  privateKeyRef: string;
  provider: LLMProvider;
  allowMockFallback: boolean;
  validatorForSchema: (schema: unknown) => ValidateFunction;
}

class Connect4DemoAgent implements AgentStrategy {
  constructor(private readonly options: Connect4AgentOptions) {}

  get playerId(): string {
    return this.options.playerId;
  }

  get name(): string {
    return this.options.name;
  }

  get walletAddress(): string {
    return this.options.walletAddress;
  }

  get privateKeyRef(): string {
    return this.options.privateKeyRef;
  }

  get gameIds(): string[] {
    return ["connect4"];
  }

  async decide(input: {
    gameId: string;
    publicState: unknown;
    actionSchema: unknown;
    playerId: string;
    validationError?: string;
  }): Promise<AgentDecision> {
    const validate = this.options.validatorForSchema(input.actionSchema);
    const started = Date.now();
    let fallbackReason: string | undefined;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const completion = await this.options.provider.complete({
          prompt: buildPrompt(input.publicState, input.actionSchema, input.validationError ?? fallbackReason),
          walletAddress: this.options.walletAddress,
          privateKeyRef: this.options.privateKeyRef,
        });
        const action = parseJsonOnly(completion.text);
        const legality = validateConnect4Action(action, input.publicState);
        if (validate(action) && legality.ok) {
          return {
            action,
            log: {
              playerId: this.playerId,
              walletAddress: this.walletAddress,
              inferenceMode: this.options.provider.mode === "0g-serving" ? "0g-serving" : "mock fallback",
              provider: completion.provider,
              model: completion.model,
              latencyMs: completion.latencyMs,
              validationResult: { ok: true },
            },
          };
        }
        if (validate(action)) {
          fallbackReason = `0G output failed Connect4 board validation on attempt ${attempt}: ${
            legality.ok ? "unknown board validation error" : legality.error
          }`;
        } else {
          fallbackReason = `0G output failed Connect4 schema validation on attempt ${attempt}: ${formatAjvError(validate.errors)}`;
        }
      } catch (error) {
        fallbackReason = `0G Connect4 inference failed on attempt ${attempt}: ${errorMessage(error)}`;
      }
    }

    if (!this.options.allowMockFallback) {
      throw new Error(fallbackReason ?? "0G Connect4 inference failed and mock fallback is disabled");
    }

    const action = chooseDeterministicMove(input.publicState, this.playerId);
    const ok = validate(action);
    return {
      action,
      log: {
        playerId: this.playerId,
        walletAddress: this.walletAddress,
        inferenceMode: "mock fallback",
        provider: "deterministic-connect4-fallback",
        model: "connect4-tactical",
        latencyMs: Date.now() - started,
        validationResult: ok ? { ok: true } : { ok: false, error: formatAjvError(validate.errors) },
        fallbackReason: fallbackReason ?? "local deterministic Connect4 strategy",
      },
    };
  }
}

export function createConnect4Agent(options: Connect4AgentOptions): AgentStrategy {
  return new Connect4DemoAgent(options);
}

function buildPrompt(publicState: unknown, actionSchema: unknown, validationError?: string): string {
  const state = publicStateRecord(publicState);
  const board = normalizeBoard(state.board);
  const validColumns = validColumnsFromState(state);
  const myId = typeof state.currentPlayer === "string" ? state.currentPlayer : "unknown";
  const players = playersFromState(state);
  const opponent = players.find((player) => player !== myId) ?? "opponent";
  return [
    "You are playing Connect4. You are a competent tactical game agent, not a random column picker.",
    "Board coordinates: rows are shown top to bottom, row 5 is the bottom, columns are 0 through 6 left to right.",
    "Only choose a column listed in VALID_COLUMNS. A column not listed is full or illegal.",
    "Priority order:",
    "1. If you have an immediate winning move, play it.",
    "2. Else if the opponent has an immediate winning move, block it.",
    "3. Else avoid any move that lets the opponent win immediately next turn.",
    "4. Else prefer center columns, build connected groups, and avoid edge-only play.",
    `BOARD_TOP_TO_BOTTOM:${boardToAscii(board)}`,
    `BOARD_JSON:${JSON.stringify(board)}`,
    `VALID_COLUMNS:${JSON.stringify(validColumns)}`,
    `MY_PLAYER_ID:${myId}`,
    `OPPONENT_PLAYER_ID:${opponent}`,
    `TACTICAL_HINT:${buildTacticalHint(board, validColumns, myId, opponent)}`,
    `LAST_MOVE:${JSON.stringify(state.lastMove ?? null)}`,
    `MOVE_COUNT:${String(state.moveCount ?? 0)}`,
    `CURRENT_PLAYER_PIECE:${String(state.currentPiece ?? "unknown")}`,
    validationError ? `CORRECTION_REQUIRED:${validationError}` : undefined,
    'Return only JSON in the shape { "column": number }. No prose. No markdown.',
    `ACTION_SCHEMA:${JSON.stringify(actionSchema)}`,
  ].filter(Boolean).join("\n");
}

function chooseDeterministicMove(publicState: unknown, playerId: string): { column: number } {
  const state = publicStateRecord(publicState);
  const board = normalizeBoard(state.board);
  const valid = validColumnsFromState(state);
  if (valid.length === 0) {
    return { column: 0 };
  }
  const players = playersFromState(state);
  const opponent = players.find((candidate) => candidate !== playerId);

  const winning = findTacticalColumn(board, valid, playerId);
  if (winning !== undefined) {
    return { column: winning };
  }
  const blocking = opponent ? findTacticalColumn(board, valid, opponent) : undefined;
  if (blocking !== undefined) {
    return { column: blocking };
  }
  const safeColumns = opponent
    ? valid.filter((column) => !letsOpponentWin(board, column, playerId, opponent))
    : valid;
  const candidateColumns = safeColumns.length > 0 ? safeColumns : valid;
  const best = candidateColumns
    .map((column) => ({ column, score: scoreMove(board, column, playerId, opponent) }))
    .sort((a, b) => b.score - a.score || Math.abs(a.column - 3) - Math.abs(b.column - 3))[0];
  if (best) {
    return { column: best.column };
  }
  return { column: valid[0] };
}

function findTacticalColumn(
  board: Array<Array<string | null>>,
  validColumns: number[],
  playerId: string,
): number | undefined {
  for (const column of validColumns) {
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

function validateConnect4Action(
  action: unknown,
  publicState: unknown,
): { ok: true } | { ok: false; error: string } {
  if (typeof action !== "object" || action === null || Array.isArray(action)) {
    return { ok: false, error: "action must be an object" };
  }
  const column = (action as Record<string, unknown>).column;
  if (typeof column !== "number" || !Number.isInteger(column)) {
    return { ok: false, error: "column must be an integer" };
  }
  const valid = validColumnsFromState(publicStateRecord(publicState));
  if (!valid.includes(column)) {
    return { ok: false, error: `column ${column} is not currently legal; valid columns are ${valid.join(", ")}` };
  }
  return { ok: true };
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
    const afterOpponent = next.map((line) => [...line]);
    afterOpponent[opponentRow][opponentColumn] = opponent;
    return hasConnect4(afterOpponent, opponentRow, opponentColumn, opponent);
  });
}

function scoreMove(
  board: Array<Array<string | null>>,
  column: number,
  playerId: string,
  opponent?: string,
): number {
  const row = lowestOpenRow(board, column);
  if (row === undefined) {
    return -1_000_000;
  }
  const next = board.map((line) => [...line]);
  next[row][column] = playerId;
  let score = 100 - Math.abs(column - 3) * 10;
  score += linePotential(next, row, column, playerId) * 20;
  if (opponent) {
    score -= linePotential(next, row, column, opponent) * 12;
  }
  return score;
}

function linePotential(
  board: Array<Array<string | null>>,
  row: number,
  column: number,
  playerId: string,
): number {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ] as const;
  return directions.reduce((best, [rowDelta, columnDelta]) => {
    const connected =
      1 +
      countDirection(board, row, column, playerId, rowDelta, columnDelta) +
      countDirection(board, row, column, playerId, -rowDelta, -columnDelta);
    return Math.max(best, connected);
  }, 1);
}

function buildTacticalHint(
  board: Array<Array<string | null>>,
  validColumns: number[],
  playerId: string,
  opponent: string,
): string {
  const winning = findTacticalColumn(board, validColumns, playerId);
  if (winning !== undefined) {
    return `Play column ${winning}; it wins immediately.`;
  }
  const blocking = findTacticalColumn(board, validColumns, opponent);
  if (blocking !== undefined) {
    return `Play column ${blocking}; it blocks the opponent's immediate win.`;
  }
  const safe = validColumns.filter((column) => !letsOpponentWin(board, column, playerId, opponent));
  if (safe.length > 0) {
    return `No immediate win or block. Prefer one of these safe columns: ${safe.join(", ")}.`;
  }
  return "Every legal move appears to allow an immediate reply; choose the best central column.";
}

function boardToAscii(board: Array<Array<string | null>>): string {
  if (board.length === 0) {
    return "unavailable";
  }
  return board
    .map((row, rowIndex) => `${rowIndex}: ${row.map((cell) => cell ?? ".").join(" | ")}`)
    .join("\n");
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

function validColumnsFromState(state: Record<string, unknown>): number[] {
  const explicit = Array.isArray(state.validColumns)
    ? state.validColumns.filter((column): column is number => typeof column === "number")
    : [];
  if (explicit.length > 0) {
    return explicit;
  }
  return validColumnsFromBoard(normalizeBoard(state.board));
}

function validColumnsFromBoard(board: Array<Array<string | null>>): number[] {
  const columns = Math.max(0, ...board.map((row) => row.length));
  return Array.from({ length: columns }, (_, column) => column).filter(
    (column) => board[0]?.[column] === null,
  );
}

function playersFromState(state: Record<string, unknown>): string[] {
  return Array.isArray(state.players)
    ? state.players.filter((player): player is string => typeof player === "string")
    : [];
}

function lowestOpenRow(board: Array<Array<string | null>>, column: number): number | undefined {
  for (let row = board.length - 1; row >= 0; row -= 1) {
    if (board[row]?.[column] === null) {
      return row;
    }
  }
  return undefined;
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

function parseJsonOnly(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("response was not a single JSON object");
  }
  return JSON.parse(trimmed);
}

function publicStateRecord(publicState: unknown): Record<string, unknown> {
  return typeof publicState === "object" && publicState !== null && !Array.isArray(publicState)
    ? publicState as Record<string, unknown>
    : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatAjvError(errors: ValidateFunction["errors"]): string {
  return errors?.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ") ?? "";
}
