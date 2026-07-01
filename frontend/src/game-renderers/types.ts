import type { ReactNode } from "react";
import type { AgentLog, MatchReceipt, MatchRenderData, MatchUiResponse, Player } from "../api";

/**
 * Props handed to every game renderer by the {@link GameRendererHost}.
 *
 * The platform shell owns the network/loading/error/receipt envelope and the
 * derived values below; a renderer only paints the game-specific stage from
 * this data. Renderers MUST NOT fetch from the backend directly — everything
 * they need comes from `match` and the convenience fields derived from it.
 */
export interface GameRendererProps {
  /** Game id from the backend (`match.gameId`). Drives renderer selection. */
  gameId: string;
  /** Match id being viewed. */
  matchId: string;
  /** The full `GET /match/:id/ui` response. */
  match: MatchUiResponse;
  /** Convenience alias for `match.render.data` (the game-specific payload). */
  ui: MatchRenderData;
  /** Players, normalised by the backend `/ui` route (name, wallet, balance). */
  players: Player[];
  /** Winner id, preferring the settled receipt over live render data. */
  winner?: string;
  /** Final settlement receipt once the backend returns it. */
  receipt?: MatchReceipt;
  /** Latest agent inference log per player id. */
  latestLogs: Map<string, AgentLog>;
  /** Last polling error message, if the shell hit one. */
  error?: string;
  /** True until the first successful `/ui` payload arrives. */
  loading: boolean;
  /** SPA navigation helper provided by the platform shell. */
  navigate: (to: string) => void;
}

/**
 * A self-contained, game-specific live renderer. Register one per game in
 * `registry.ts`. The host falls back to {@link GenericGameRenderer} when no
 * renderer is registered for a given `gameId`.
 */
export interface GameRenderer {
  /** Game id this renderer paints (matches `IGameEngine.id` on the backend). */
  gameId: string;
  /** Human-readable label, used by the generic fallback and dev tooling. */
  label: string;
  /** Render the game-specific live stage from the host-provided props. */
  render(props: GameRendererProps): ReactNode;
}
