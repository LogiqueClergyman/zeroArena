import type { CSSProperties } from "react";
import type { AgentLog, MatchReceipt, MatchUiResponse, Player } from "../api";
import {
  cx,
  EmptyState,
  EvidenceRow,
  FundingRow,
  StatusBanner,
  formatMaybe,
  formatTime,
  playerName,
  shortHash,
  shortId,
} from "./shared";

type LiveProps = {
  ui?: MatchUiResponse;
  data?: MatchUiResponse["render"]["data"];
  players: Player[];
  winner?: string;
  receipt?: MatchReceipt;
  latestLogs: Map<string, AgentLog>;
  matchId: string;
  navigate: (to: string) => void;
  error?: string;
  loading: boolean;
};

export function Connect4LiveScreen(props: LiveProps) {
  const { ui, data, players, winner, receipt, latestLogs, matchId, navigate, error, loading } = props;
  const status = ui?.status ?? "waiting";

  return (
    <div className="c4-page">
      <div className="c4-clouds" aria-hidden />
      <div className="c4-game">
        <div className="c4-game-header">
          <div className="c4-game-header-left">
            <button className="c4-crumb" onClick={() => navigate("/games/connect4")}>
              ← Connect Four
            </button>
            <span className={cx("c4-status-chip", status === "failed" ? "bad" : "hot")}>
              <span className="c4-chip-dot" />
              {status.toUpperCase()}
            </span>
            <span className="c4-match-tag">table {shortId(matchId)}</span>
          </div>
          <div className="c4-game-header-right">
            <button className="c4-btn c4-btn-primary" onClick={() => navigate("/games/connect4")}>
              Game detail
            </button>
            <button className="c4-btn c4-btn-ghost" onClick={() => navigate("/games")}>
              Arena
            </button>
          </div>
        </div>

        {error ? <StatusBanner tone="bad" label="Polling error" value={error} /> : null}
        {ui?.runnerError ? <StatusBanner tone="bad" label="Agent runner error" value={ui.runnerError} /> : null}
        {loading ? <StatusBanner tone="warn" label="Loading" value="Waiting for match data..." /> : null}

        <div className="c4-title-strip">
          <span className="c4-title-orb c4-orb-red" />
          <h1 className="c4-game-title">Connect Four</h1>
          <span className="c4-title-orb c4-orb-yellow" />
        </div>
        <p className="c4-tagline">Four in a row takes the pot · agents only</p>

        <C4Stage data={data} players={players} winner={winner} status={status} receipt={receipt} />
      </div>

      <section className="c4-info-section">
        <div className="c4-info-banner">
          <span className="c4-info-banner-line" />
          <span className="c4-info-banner-label">Match Intel</span>
          <span className="c4-info-banner-line" />
        </div>
        <div className="c4-info-grid">
          <article className="c4-info-card">
            <h2><span className="c4-card-pip pip-green" />Settlement signals</h2>
            <C4ProofStrip data={data} receipt={receipt} status={status} />
          </article>
          <article className="c4-info-card">
            <h2><span className="c4-card-pip pip-purple" />Move timeline</h2>
            <C4MoveList moves={data?.moves ?? []} players={players} expanded />
          </article>
          <article className="c4-info-card">
            <h2><span className="c4-card-pip pip-blue" />Agents</h2>
            <C4AgentGrid players={players} latestLogs={latestLogs} winner={winner} />
          </article>
        </div>
        <article className="c4-info-card">
          <h2><span className="c4-card-pip pip-yellow" />Prize pool evidence</h2>
          <C4PrizePoolEvidence ui={ui} receipt={receipt} />
        </article>
        <article className="c4-info-card">
          <h2><span className="c4-card-pip pip-red" />Final receipt</h2>
          <C4FinalReceipt receipt={receipt} winner={winner} status={ui?.status} />
        </article>
      </section>
    </div>
  );
}

function C4Stage({
  data,
  players,
  winner,
  status,
  receipt,
}: {
  data?: MatchUiResponse["render"]["data"];
  players: Player[];
  winner?: string;
  status: string;
  receipt?: MatchReceipt;
}) {
  const board = data?.board ?? [];
  const columns = Number(data?.columns ?? 7);
  const currentPlayer = data?.currentPlayer;
  const outcome = receipt?.outcome ?? data?.outcome ?? (winner ? "winner" : undefined);
  const winningCells = new Set((data?.winningCells ?? []).map((cell) => `${cell.row}:${cell.column}`));
  const lastMoveKey = data?.lastMove ? `${data.lastMove.row}:${data.lastMove.column}` : "";
  const settled = Boolean(receipt);
  const [left, right] = players;
  const settlementTx =
    receipt?.payoutTxHash ?? receipt?.refundTxHashes?.map((tx) => tx.txHash).filter(Boolean).join(" / ");

  const activeLeft = currentPlayer === left?.id && !settled;
  const activeRight = currentPlayer === right?.id && !settled;

  const statusLabel =
    outcome === "draw"
      ? "It's a Draw! Board is full!"
      : winner
        ? `${playerName(players, winner)} connects four!`
        : currentPlayer
          ? `${playerName(players, currentPlayer)}'s turn!`
          : "Waiting for first drop...";

  return (
    <div className="c4-arena">
      <div className="c4-field">
        <C4Player player={left} color="red" active={activeLeft} isWinner={winner === left?.id} />

        <div className="c4-board-shell">
          <div className="c4-board-frame">
            <div className="c4-board" style={{ "--cols": columns } as CSSProperties}>
              {board.length === 0
                ? Array.from({ length: columns * 6 }, (_, index) => (
                    <div className="c4-hole" key={`empty-${index}`}>
                      <div className="c4-disc empty" />
                    </div>
                  ))
                : board.map((row, rowIndex) =>
                    row.map((cell, colIndex) => {
                      const key = `${rowIndex}:${colIndex}`;
                      const ownerIndex = players.findIndex((p) => p.id === cell);
                      const tone = ownerIndex === 0 ? "red" : ownerIndex === 1 ? "yellow" : "empty";
                      return (
                        <div className="c4-hole" key={key}>
                          <div
                            className={cx(
                              "c4-disc",
                              cell ? tone : "empty",
                              lastMoveKey === key && "last",
                              winningCells.has(key) && "winning",
                              winner && cell && !winningCells.has(key) && "dim",
                            )}
                          />
                        </div>
                      );
                    }),
                  )}
            </div>
          </div>
          <div className="c4-board-legs">
            <div className="c4-leg" />
            <div className="c4-leg" />
          </div>
        </div>

        <C4Player player={right} color="yellow" active={activeRight} isWinner={winner === right?.id} right />
      </div>

      <div className="c4-status-row">
        <div className={cx("c4-status-pill", (settled || winner) && "done", outcome === "draw" && "is-draw")}>
          <span className="c4-status-text">{statusLabel}</span>
          <span className="c4-move-badge">
            {data?.moveCount ?? 0} / {columns * 6}
          </span>
        </div>
      </div>

      {receipt ? (
        <div className={cx("c4-result-banner", receipt.outcome === "draw" ? "is-draw" : "is-win")}>
          <div className="c4-result-stars" aria-hidden>
            <i />
            <i />
            <i />
          </div>
          <div className="c4-result-headline">
            {receipt.outcome === "draw"
              ? "It's a Draw!"
              : `${playerName(players, receipt.winner ?? winner ?? "winner")} Wins!`}
          </div>
          <div className="c4-result-sub">
            {receipt.outcome === "draw"
              ? `Both stakes refunded${settlementTx ? ` · tx ${shortHash(settlementTx)}` : ""}`
              : `Settled on-chain · 0G Archived${receipt.payoutTxHash ? ` · tx ${shortHash(receipt.payoutTxHash)}` : ""}`}
          </div>
        </div>
      ) : status === "failed" ? (
        <div className="c4-result-banner is-fail">
          <div className="c4-result-headline">Match Failed</div>
          <div className="c4-result-sub">The backend reported a failed match.</div>
        </div>
      ) : null}
    </div>
  );
}

function C4Player({
  player,
  color,
  active,
  isWinner,
  right,
}: {
  player?: Player;
  color: "red" | "yellow";
  active: boolean;
  isWinner: boolean;
  right?: boolean;
}) {
  return (
    <div className={cx("c4-player-card", color, right && "flip", active && "active", isWinner && "is-winner")}>
      <div className="c4-player-orb-wrap">
        <div className={cx("c4-player-orb", color)} />
      </div>
      <div className="c4-player-name">{player?.name ?? "Awaiting agent"}</div>
      <div className="c4-player-addr">{shortHash(player?.walletAddress) || player?.id || "—"}</div>
      {active && (
        <div className="c4-thinking-row">
          <span className="c4-dot" style={{ animationDelay: "0s" }} />
          <span className="c4-dot" style={{ animationDelay: "0.18s" }} />
          <span className="c4-dot" style={{ animationDelay: "0.36s" }} />
        </div>
      )}
      {isWinner && (
        <div className="c4-winner-tag">
          <span className="c4-crown-shape" aria-hidden />
          Winner
        </div>
      )}
    </div>
  );
}

function C4ProofStrip({
  data,
  receipt,
  status,
}: {
  data?: MatchUiResponse["render"]["data"];
  receipt?: MatchReceipt;
  status: string;
}) {
  const settlementTx =
    receipt?.payoutTxHash ?? receipt?.refundTxHashes?.map((tx) => tx.txHash).filter(Boolean).join(" / ");
  return (
    <div className="evidence-grid">
      <EvidenceRow
        label="Pool"
        value={receipt || data?.fullyFunded ? "funded" : data?.fullyFunded === false ? "funding pending" : "pending"}
        tone={receipt || data?.fullyFunded ? "good" : "warn"}
      />
      <EvidenceRow
        label="Archive"
        value={
          receipt?.archiveHash
            ? shortHash(receipt.archiveHash)
            : status === "archived" || status === "paid"
              ? status
              : "pending"
        }
        mono
        tone={receipt?.archiveHash ? (receipt.archiveMode === "0g" ? "good" : "warn") : "warn"}
      />
      <EvidenceRow
        label={receipt?.outcome === "draw" ? "Refund" : "Payout"}
        value={settlementTx ? shortHash(settlementTx) : receipt ? "not returned" : "pending"}
        mono
        tone={settlementTx ? "good" : receipt ? "bad" : "warn"}
      />
      <EvidenceRow
        label="Receipt"
        value={
          receipt
            ? `complete ${formatTime(receipt.completedAt)}`
            : status === "finished" || status === "archived"
              ? "settlement pending"
              : "pending"
        }
        tone={receipt ? "good" : status === "finished" || status === "archived" ? "warn" : undefined}
      />
    </div>
  );
}

function C4MoveList({
  moves,
  players,
  expanded,
}: {
  moves: Array<{ playerId: string; row: number; column: number }>;
  players: Player[];
  expanded?: boolean;
}) {
  const visible = expanded ? moves : moves.slice(-8);
  if (visible.length === 0) {
    return <EmptyState text="Connect4 moves will appear after the first backend-submitted drop." />;
  }
  const total = moves.length;
  const offset = expanded ? 0 : Math.max(0, total - visible.length);
  return (
    <div className="c4-move-list">
      {visible.map((move, index) => {
        const ownerIndex = players.findIndex((p) => p.id === move.playerId);
        const color = ownerIndex === 1 ? "yellow" : "red";
        return (
          <div className="c4-move-row" key={`${move.playerId}-${move.row}-${move.column}-${index}`}>
            <span className="c4-move-no">{offset + index + 1}</span>
            <span className={cx("c4-move-disc", color)} aria-hidden />
            <strong className="move-player">{playerName(players, move.playerId)}</strong>
            <span className="move-col">Col {move.column + 1}</span>
          </div>
        );
      })}
    </div>
  );
}

function C4AgentGrid({
  players,
  latestLogs,
  winner,
}: {
  players: Player[];
  latestLogs: Map<string, AgentLog>;
  winner?: string;
}) {
  return (
    <div className="agent-grid">
      {players.length === 0 ? <EmptyState text="Agent data pending from backend." /> : null}
      {players.map((player) => (
        <C4AgentCard
          key={player.id}
          player={player}
          latestLog={latestLogs.get(player.id)}
          winner={winner === player.id}
        />
      ))}
    </div>
  );
}

function C4AgentCard({
  player,
  latestLog,
  winner,
}: {
  player: Player;
  latestLog?: AgentLog;
  winner: boolean;
}) {
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
      <EvidenceRow label="Balance" value={formatMaybe(player.balance)} />
      <EvidenceRow label="Provider" value={latestLog?.provider ?? "pending"} />
      <EvidenceRow label="Model" value={latestLog?.model ?? "pending"} />
      <EvidenceRow label="Last latency" value={latestLog ? `${latestLog.latencyMs} ms` : "pending"} />
      {latestLog?.fallbackReason ? (
        <StatusBanner tone="warn" label="Fallback" value={latestLog.fallbackReason} />
      ) : null}
    </article>
  );
}

function C4PrizePoolEvidence({ ui, receipt }: { ui?: MatchUiResponse; receipt?: MatchReceipt }) {
  const data = ui?.render.data;
  const funding = receipt?.fundingTxHashes ?? data?.fundingTxHashes ?? [];
  const poolCreation = data?.poolCreationTxHash ?? data?.creationTxHash;
  const fullyFunded = receipt ? true : data?.fullyFunded;
  const prizePoolAddress = receipt?.prizePoolAddress ?? data?.prizePoolAddress;
  const stakeWei = receipt?.stakeWei ?? data?.stakeWei ?? data?.matchStakeWei;
  const rulesHash = receipt?.rulesHash ?? data?.rulesHash;

  return (
    <div className="evidence-grid">
      <EvidenceRow label="PrizePool contract" value={prizePoolAddress ?? "pending from backend"} mono />
      <EvidenceRow label="MATCH_STAKE_WEI" value={stakeWei ?? "pending from backend"} mono />
      <EvidenceRow
        label="Rulebook hash"
        value={rulesHash ?? "pending from backend"}
        mono
        tone={rulesHash ? "good" : "warn"}
      />
      <EvidenceRow
        label="Rulebook version"
        value={receipt?.rulesVersion ?? "pending until receipt"}
        tone={receipt?.rulesVersion ? "good" : "warn"}
      />
      <EvidenceRow
        label="Rulebook retrieval"
        value={receipt?.rulesUrl ?? "pending until final receipt"}
        mono
        tone={receipt?.rulesUrl ? "good" : "warn"}
      />
      <EvidenceRow
        label="Pool creation tx"
        value={poolCreation ?? "unavailable from current /ui payload"}
        mono
        tone={poolCreation ? "good" : "warn"}
      />
      <EvidenceRow
        label="Fully funded"
        value={fullyFunded === undefined ? "pending from backend" : fullyFunded ? "true" : "false"}
        tone={fullyFunded ? "good" : "warn"}
      />
      <EvidenceRow
        label="Total pool wei"
        value={receipt?.totalPoolWei ?? data?.totalPoolWei ?? "pending until receipt"}
        mono
      />
      <EvidenceRow
        label="Archive mode"
        value={receipt?.archiveMode ?? "pending"}
        tone={receipt?.archiveMode === "0g" ? "good" : receipt?.archiveMode ? "warn" : undefined}
      />
      {data?.storageError ? <StatusBanner tone="bad" label="Storage failure" value={data.storageError} /> : null}
      {data?.payoutError ? <StatusBanner tone="bad" label="Payout failure" value={data.payoutError} /> : null}
      {data?.prizePoolError ? (
        <StatusBanner tone="bad" label="PrizePool read failure" value={data.prizePoolError} />
      ) : null}
      <div className="tx-list">
        <h3>Funding transactions</h3>
        {funding.length === 0 ? <EmptyState text="Funding transaction hashes pending from backend." /> : null}
        {funding.map((tx) => (
          <FundingRow key={`${tx.playerId}-${tx.txHash}`} tx={tx} />
        ))}
      </div>
    </div>
  );
}

function C4FinalReceipt({
  receipt,
  winner,
  status,
}: {
  receipt?: MatchReceipt;
  winner?: string;
  status?: string;
}) {
  if (!receipt) {
    return (
      <div className="receipt-pending">
        <EvidenceRow label="Winner" value={winner ?? "pending"} />
        <EvidenceRow label="Receipt status" value={status ?? "pending"} />
        <EmptyState text="Final receipt is pending. Archive hash, payout tx, and inference summary stay empty until the backend returns them." />
      </div>
    );
  }
  return (
    <div className="receipt-grid">
      <EvidenceRow label="Match ID" value={receipt.matchId} mono />
      <EvidenceRow label="Outcome" value={receipt.outcome ?? (receipt.winner ? "winner" : "pending")} />
      <EvidenceRow label="Winner" value={receipt.winner ?? "none - draw refund"} />
      <EvidenceRow label="Winner wallet" value={receipt.winnerWalletAddress ?? "none - draw refund"} mono />
      <EvidenceRow
        label="0G Storage hash"
        value={receipt.archiveHash}
        mono
        tone={receipt.archiveMode === "0g" ? "good" : "warn"}
      />
      <EvidenceRow
        label="Storage retrieval"
        value={receipt.archiveUrl ?? "Use the 0G storage indexer with this root hash."}
        mono
      />
      <EvidenceRow label="Rulebook hash" value={receipt.rulesHash} mono tone="good" />
      <EvidenceRow label="Payout amount wei" value={receipt.payoutAmountWei ?? "none - draw refund"} mono />
      <EvidenceRow
        label="Payout tx hash"
        value={receipt.payoutTxHash ?? "none - draw refund"}
        mono
        tone={receipt.payoutTxHash ? "good" : receipt.outcome === "draw" ? "warn" : "bad"}
      />
      <EvidenceRow
        label="Refund amount wei"
        value={receipt.refundAmountWei ?? "none"}
        mono
        tone={receipt.refundAmountWei ? "good" : undefined}
      />
      <EvidenceRow label="Completed" value={receipt.completedAt} />
      {receipt.refundTxHashes && receipt.refundTxHashes.length > 0 ? (
        <div className="tx-list">
          <h3>Draw refund transactions</h3>
          {receipt.refundTxHashes.map((tx) => (
            <FundingRow key={`${tx.playerId}-${tx.txHash}`} tx={tx} />
          ))}
        </div>
      ) : null}
      <div className="tx-list">
        <h3>Per-agent inference summary</h3>
        {receipt.agentInference.map((item) => (
          <div className="summary-row" key={item.playerId}>
            <strong>{item.playerId}</strong>
            <span className={cx("pill", item.mode === "0g-serving" ? "good" : "warn")}>{item.mode}</span>
            <span>{item.turns} turns</span>
            <span>{item.fallbackTurns} fallback</span>
            <code>{item.walletAddress}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
