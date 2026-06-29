import type {
  GameState,
  PlayerId,
  TerminationResult,
  ValidationResult,
} from "./types.js";

export interface UIRenderPayload {
  kind: string;
  data: unknown;
}

export interface IGameEngine {
  readonly id: string;
  readonly name: string;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly actionSchema: unknown;

  initState(players: PlayerId[]): GameState;
  getPublicState(state: GameState, forPlayer: PlayerId): unknown;
  validateMove(
    state: GameState,
    move: unknown,
    player: PlayerId,
  ): ValidationResult;
  applyMove(state: GameState, move: unknown, player: PlayerId): GameState;
  getDefaultMove?(state: GameState, player: PlayerId): unknown;
  applyForfeit?(state: GameState, timedOutPlayer: PlayerId): GameState;
  checkTermination(state: GameState): TerminationResult;
  renderForUI(state: GameState): UIRenderPayload;
}
