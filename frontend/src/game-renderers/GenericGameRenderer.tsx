import type { AgentLog, FundingTxReceipt, Player } from "../api";
import type { GameRendererProps } from "./types";
import "./generic.css";

/* ===== Generic-renderer-local helpers & primitives — owned by this fallback, shared with no game ===== */

function cx(...values: Array<string | false | undefined | null>): string {
  return values.filter(Boolean).join(" ");
}

function playerName(players: Player[], playerId: string): string {
  return players.find((player) => player.id === playerId)?.name ?? playerId;
}

function shortHash(value?: string): string {
  if (!value) {
    return "";
  }
  if (value.length <= 18) {
    return value;
  }
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatTime(value?: string): string {
  if (!value) {
    return "pending";
  }
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) {
    return value;
  }
  return time.toLocaleTimeString();
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function StatusBanner({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" | "bad" }) {
  return (
    <div className={cx("status-banner", tone)}>
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  );
}

function EvidenceRow({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className={cx("evidence-row", tone)}>
      <span>{label}</span>
      <strong className={mono ? "mono" : undefined}>{value}</strong>
    </div>
  );
}

function FundingRow({ tx }: { tx: FundingTxReceipt }) {
  return (
    <div className="funding-row">
      <strong>{tx.playerId}</strong>
      <code>{tx.txHash}</code>
      <span>{tx.amountWei} wei</span>
      <small>{tx.walletAddress}</small>
    </div>
  );
}

function CompactAgentCard({ player, latestLog, winner }: { player: Player; latestLog?: AgentLog; winner: boolean }) {
  const mode = latestLog?.inferenceMode ?? player.inferenceMode ?? player.agentKind ?? "pending";
  return (
    <article className={cx("agent-card", winner && "winner")}>
      <div className="agent-top">
        <div>
          <h3>{player.name || player.id}</h3>
          <small>{player.id}</small>
        </div>
        <span className={cx("pill", mode === "0g-serving" ? "good" : "warn")}>{mode}</span>
      </div>
      <EvidenceRow label="Wallet" value={player.walletAddress || "pending"} mono />
      <EvidenceRow label="Provider" value={latestLog?.provider ?? "pending"} />
      <EvidenceRow label="Model" value={latestLog?.model ?? "pending"} />
      <EvidenceRow label="Last latency" value={latestLog ? `${latestLog.latencyMs} ms` : "pending"} />
      {latestLog?.fallbackReason ? <StatusBanner tone="warn" label="Fallback" value={latestLog.fallbackReason} /> : null}
    </article>
  );
}

/**
 * Fallback renderer for any game that has no dedicated renderer registered.
 *
 * It deliberately stays in the neutral platform palette (no game-specific
 * colours) and surfaces everything the shell knows: ids, status, players,
 * round, a raw JSON inspector of the render payload, and the settlement
 * receipt when present. This keeps an unknown game watchable and debuggable
 * without pretending the platform understands its visual semantics.
 */
export function GenericGameRenderer(props: GameRendererProps) {
  const { gameId, matchId, match, ui, players, winner, receipt, latestLogs, error, loading, navigate } = props;
  const status = match.status;
  const kind = match.render?.kind ?? "unknown";
  const round = ui?.round;

  return (
    <section className="screen generic-renderer">
      <div className="generic-head">
        <button className="back-link" onClick={() => navigate("/games")}>
          ← Arena
        </button>
        <h1 className="page-title">{gameId}</h1>
        <span className={cx("pill", status === "failed" ? "bad" : "warn")}>{status.toUpperCase()}</span>
      </div>

      <StatusBanner
        tone="warn"
        label="No renderer installed for this game"
        value={`Showing the generic inspector for "${gameId}". Register a renderer under frontend/src/game-renderers/${gameId}/ to give it a dedicated stage.`}
      />

      {error ? <StatusBanner tone="bad" label="Polling error" value={error} /> : null}
      {match.runnerError ? <StatusBanner tone="bad" label="Agent runner error" value={match.runnerError} /> : null}
      {loading ? <StatusBanner tone="warn" label="Loading" value="Waiting for match UI payload…" /> : null}

      <div className="generic-grid">
        <article className="data-card">
          <h2>Match</h2>
          <div className="evidence-grid">
            <EvidenceRow label="Game id" value={gameId} mono />
            <EvidenceRow label="Render kind" value={kind} mono />
            <EvidenceRow label="Match id" value={matchId} mono />
            <EvidenceRow label="Status" value={status} />
            <EvidenceRow label="Round" value={round !== undefined ? String(round) : "—"} />
            <EvidenceRow label="Winner" value={winner ? playerName(players, winner) : "—"} />
          </div>
        </article>

        <article className="data-card">
          <h2>Players</h2>
          <div className="agent-grid">
            {players.length === 0 ? <EmptyState text="No players returned by the backend yet." /> : null}
            {players.map((player) => (
              <CompactAgentCard
                key={player.id}
                player={player}
                latestLog={latestLogs.get(player.id)}
                winner={winner === player.id}
              />
            ))}
          </div>
        </article>
      </div>

      <article className="data-card">
        <h2>Render payload · ui.data</h2>
        <pre className="generic-json">{JSON.stringify(ui ?? {}, null, 2)}</pre>
      </article>

      <article className="data-card">
        <h2>Settlement receipt</h2>
        {receipt ? (
          <div className="evidence-grid">
            <EvidenceRow label="Outcome" value={receipt.outcome ?? (receipt.winner ? "winner" : "pending")} />
            <EvidenceRow label="Winner" value={receipt.winner ?? "none — draw refund"} />
            <EvidenceRow
              label="0G Storage hash"
              value={receipt.archiveHash ? shortHash(receipt.archiveHash) : "pending"}
              mono
              tone={receipt.archiveMode === "0g" ? "good" : "warn"}
            />
            <EvidenceRow label="PrizePool" value={receipt.prizePoolAddress ?? "pending"} mono />
            <EvidenceRow
              label={receipt.outcome === "draw" ? "Refund tx" : "Payout tx"}
              value={receipt.payoutTxHash ? shortHash(receipt.payoutTxHash) : "pending"}
              mono
              tone={receipt.payoutTxHash ? "good" : "warn"}
            />
            <EvidenceRow label="Completed" value={formatTime(receipt.completedAt)} />
            <div className="tx-list">
              <h3>Funding transactions</h3>
              {receipt.fundingTxHashes.length === 0 ? (
                <EmptyState text="No funding transactions in the receipt." />
              ) : null}
              {receipt.fundingTxHashes.map((tx) => (
                <FundingRow key={`${tx.playerId}-${tx.txHash}`} tx={tx} />
              ))}
            </div>
          </div>
        ) : (
          <EmptyState text="Final receipt is pending. Proof and settlement evidence stay empty until the backend returns them." />
        )}
      </article>
    </section>
  );
}
