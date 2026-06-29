export type PlayerId = string;

export interface GameState {
  gameId: string;
  board: unknown;
  currentPlayer?: PlayerId;
  players: PlayerId[];
  round: number;
  status: "waiting" | "active" | "finished";
  winner?: PlayerId;
  publicContext?: unknown;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export interface TerminationResult {
  finished: boolean;
  outcome?: "winner" | "draw";
  winner?: PlayerId;
  reason?: string;
}
