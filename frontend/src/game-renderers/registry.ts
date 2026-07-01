import { createElement } from "react";
import { Connect4Renderer } from "./connect4/Connect4Renderer";
import { SignalDuelRenderer } from "./signal-duel/SignalDuelRenderer";
import { SovereignBluffRenderer } from "./sovereign-bluff/SovereignBluffRenderer";
import type { GameRenderer } from "./types";

/**
 * Build-time registry of approved, in-repo game renderers.
 *
 * This is intentionally a static map: the MVP bundles every approved renderer
 * at build time. There is NO remote/dynamic/untrusted renderer loading — no
 * iframes, eval, CDN imports, or plugin execution. To add a game, drop a
 * renderer module under `game-renderers/<gameId>/` and register it here.
 *
 * `createElement` (rather than calling the component as a function) ensures
 * each renderer mounts as a real React component, so its hooks behave.
 */
const renderers: GameRenderer[] = [
  {
    gameId: "connect4",
    label: "Connect Four",
    render: (props) => createElement(Connect4Renderer, props),
  },
  {
    gameId: "sovereign-bluff",
    label: "Sovereign Bluff",
    render: (props) => createElement(SovereignBluffRenderer, props),
  },
  {
    gameId: "signal-duel",
    label: "Signal Duel",
    render: (props) => createElement(SignalDuelRenderer, props),
  },
];

const registry = new Map<string, GameRenderer>(renderers.map((renderer) => [renderer.gameId, renderer]));

/** Look up a registered renderer by game id, or `undefined` if none exists. */
export function getRenderer(gameId: string): GameRenderer | undefined {
  return registry.get(gameId);
}

/** All registered renderers, in registration order. */
export function listRenderers(): GameRenderer[] {
  return renderers;
}
