import { useEffect, useMemo, useRef, useState } from "react";
import { getMatchUi, type AgentLog, type MatchUiResponse } from "../api";
import { GenericGameRenderer } from "./GenericGameRenderer";
import { getRenderer } from "./registry";
import type { GameRendererProps } from "./types";

/**
 * Generic match shell. The platform owns everything game-agnostic here:
 *
 *   · fetching `GET /match/:id/ui`
 *   · the 1s polling loop and its stop condition
 *   · the pre-first-payload loading / error envelope
 *   · deriving players / winner / receipt / agent logs once
 *
 * It then delegates the game-specific stage to a registered renderer, or to
 * {@link GenericGameRenderer} when no renderer is installed for the game.
 * No game-specific branching lives outside the registry.
 */
export function GameRendererHost({ matchId, navigate }: { matchId: string; navigate: (to: string) => void }) {
  const [ui, setUi] = useState<MatchUiResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const stableReceiptRef = useRef({ value: "", count: 0 });

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await getMatchUi(matchId);
        if (stopped) {
          return;
        }
        setUi(next);
        setError(undefined);
        setLoading(false);
        if (!shouldStopPolling(next, stableReceiptRef.current)) {
          timer = window.setTimeout(poll, 1000);
        }
      } catch (err) {
        if (!stopped) {
          setError(errorMessage(err));
          setLoading(false);
          timer = window.setTimeout(poll, 1000);
        }
      }
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [matchId]);

  const data = ui?.render.data;
  const players = data?.players ?? [];
  const receipt = ui?.receipt;
  const winner = receipt?.winner ?? data?.winner;
  const latestLogs = useMemo(() => latestLogByPlayer(ui?.agentLogs ?? []), [ui?.agentLogs]);

  // Before the first payload arrives we don't know the game yet — show a
  // neutral platform envelope rather than guessing a game theme.
  if (!ui) {
    return (
      <section className="screen">
        <button className="back-link" onClick={() => navigate("/games")}>
          ← Arena
        </button>
        {error ? (
          <StatusBanner tone="bad" label="Backend error" value={error} />
        ) : (
          <StatusBanner tone="warn" label="Loading" value={`Opening match ${matchId}…`} />
        )}
      </section>
    );
  }

  const props: GameRendererProps = {
    gameId: ui.gameId,
    matchId,
    match: ui,
    ui: data ?? {},
    players,
    winner,
    receipt,
    latestLogs,
    error,
    loading,
    navigate,
  };

  const renderer = getRenderer(ui.gameId);
  return <>{renderer ? renderer.render(props) : <GenericGameRenderer {...props} />}</>;
}

function shouldStopPolling(ui: MatchUiResponse, stable: { value: string; count: number }): boolean {
  if (ui.status === "failed") {
    return true;
  }
  if (!ui.receipt) {
    stable.value = "";
    stable.count = 0;
    return false;
  }
  const serialized = JSON.stringify(ui.receipt);
  if (stable.value === serialized) {
    stable.count += 1;
  } else {
    stable.value = serialized;
    stable.count = 1;
  }
  return stable.count >= 2;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function latestLogByPlayer(logs: AgentLog[]): Map<string, AgentLog> {
  const latest = new Map<string, AgentLog>();
  for (const log of logs) {
    latest.set(log.playerId, log);
  }
  return latest;
}

/** Neutral platform-shell banner for the pre-first-payload envelope. */
function StatusBanner({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" | "bad" }) {
  return (
    <div className={`status-banner ${tone}`}>
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  );
}
