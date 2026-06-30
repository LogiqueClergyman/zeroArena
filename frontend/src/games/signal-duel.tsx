import type { AgentLog, MatchReceipt, MatchUiResponse, Player, SignalDuelRoundHistory } from "../api";
import {
  CompactAgentCard,
  cx,
  EmptyState,
  EvidenceRow,
  FundingRow,
  playerName,
  shortHash,
  shortId,
  StatusBanner,
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

const moveGlyph = {
  rock: "ROCK",
  paper: "PAPER",
  scissors: "SCISSORS",
} as const;

export function SignalDuelLiveScreen(props: LiveProps) {
  const { ui, data, players, winner, receipt, latestLogs, matchId, navigate, error, loading } = props;
  const [left, right] = players;
  const status = ui?.status ?? "waiting";
  const round = Number(data?.round ?? 1);
  const totalRounds = Number(data?.totalRounds ?? 3);
  const phase = data?.phase ?? "pending";
  const scores = data?.scores ?? {};
  const history = data?.roundHistory ?? [];
  const lastReveal = data?.lastReveal ?? history.at(-1);
  const pending = data?.pendingCommits ?? [];
  const currentPlayer = data?.currentPlayer;
  const dialogue = data?.dialogue ?? [];
  const settled = Boolean(receipt);
  const outcome = receipt?.outcome ?? data?.outcome;

  return (
    <div className="sd-page">
      <div className="sd-table">
        <header className="sd-top">
          <button className="sd-crumb" onClick={() => navigate("/games/signal-duel")}>Signal Duel</button>
          <span className={cx("sd-status", status === "failed" && "bad")}>{status.toUpperCase()}</span>
          <span className="sd-id">table {shortId(matchId)}</span>
          <div className="sd-spacer" />
          <button className="sd-btn" onClick={() => navigate("/games")}>Arena</button>
        </header>

        {error ? <StatusBanner tone="bad" label="Polling error" value={error} /> : null}
        {loading ? <StatusBanner tone="warn" label="Loading" value="Waiting for Signal Duel state..." /> : null}
        {ui?.runnerError ? <StatusBanner tone="bad" label="Agent runner error" value={ui.runnerError} /> : null}

        <section className="sd-hero">
          <div className="sd-title-block">
            <div className="sd-kicker">ROUND {round} / {totalRounds} · {phase}</div>
            <h1>Signal Duel</h1>
            <p>Hidden commits. Public pressure. No opponent inventory hints.</p>
          </div>
          <div className="sd-scoreboard">
            {players.map((player) => (
              <div className={cx("sd-score", winner === player.id && "win")} key={player.id}>
                <span>{player.name || shortHash(player.id)}</span>
                <b>{scores[player.id] ?? 0}</b>
              </div>
            ))}
          </div>
        </section>

        <section className="sd-stage">
          <Duelist
            player={left}
            side="left"
            score={Number(scores[left?.id ?? ""] ?? 0)}
            active={currentPlayer === left?.id && !settled}
            committed={commitSubmitted(pending, left?.id)}
            moves={playedMoves(history, left?.id)}
            validMoves={data?.validMovesByPlayer?.[left?.id ?? ""] ?? []}
            winner={winner === left?.id}
          />

          <div className="sd-center">
            <div className="sd-signal-line" />
            <div className="sd-commit-row">
              <CommitSlot player={left} committed={commitSubmitted(pending, left?.id)} reveal={lastReveal} />
              <div className="sd-versus">VS</div>
              <CommitSlot player={right} committed={commitSubmitted(pending, right?.id)} reveal={lastReveal} />
            </div>
            <div className={cx("sd-phase-box", outcome === "draw" && "draw", winner && "winner")}>
              {receipt ? (
                receipt.outcome === "draw" ? "Final draw: refund path complete" : `${playerName(players, receipt.winner ?? winner ?? "")} wins the pool`
              ) : phase === "dialogue" ? (
                `${playerName(players, currentPlayer ?? "")} has the next line`
              ) : phase === "commit" ? (
                "Commit slots stay face-down until both agents lock"
              ) : (
                "Waiting for backend state"
              )}
            </div>
            <RoundPips round={round} total={totalRounds} history={history} />
          </div>

          <Duelist
            player={right}
            side="right"
            score={Number(scores[right?.id ?? ""] ?? 0)}
            active={currentPlayer === right?.id && !settled}
            committed={commitSubmitted(pending, right?.id)}
            moves={playedMoves(history, right?.id)}
            validMoves={data?.validMovesByPlayer?.[right?.id ?? ""] ?? []}
            winner={winner === right?.id}
          />
        </section>

        <section className="sd-lower">
          <article className="sd-panel transcript">
            <h2>Duel banter</h2>
            <div className="sd-feed">
              {dialogue.length === 0 ? <EmptyState text="Dialogue appears here when the first agent speaks." /> : null}
              {dialogue.slice(-12).map((line, index) => (
                <div className={cx("sd-line", line.playerId === left?.id ? "left" : "right")} key={`${line.round}-${line.turn}-${index}`}>
                  <span>{playerName(players, line.playerId)} · R{line.round}.{line.turn}</span>
                  <p>{line.message}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="sd-panel history">
            <h2>Reveal strip</h2>
            <div className="sd-history-strip">
              {history.length === 0 ? <EmptyState text="Reveals remain empty until both commits resolve a round." /> : null}
              {history.map((round) => (
                <div className={cx("sd-round-card", round.result === "tie" && "tie")} key={round.round}>
                  <span>R{round.round}</span>
                  <div>{moveGlyph[round.moves[left?.id ?? ""]]} / {moveGlyph[round.moves[right?.id ?? ""]]}</div>
                  <strong>{round.winner ? playerName(players, round.winner) : "tie"}</strong>
                </div>
              ))}
            </div>
          </article>
        </section>
      </div>

      <section className="sd-evidence">
        <article className="data-card">
          <h2>Agents</h2>
          <div className="agent-grid">
            {players.map((player) => (
              <CompactAgentCard key={player.id} player={player} latestLog={latestLogs.get(player.id)} winner={winner === player.id} />
            ))}
          </div>
        </article>
        <article className="data-card">
          <h2>Settlement evidence</h2>
          <SignalSettlement ui={ui} receipt={receipt} winner={winner} />
        </article>
      </section>
    </div>
  );
}

function Duelist({
  player,
  side,
  score,
  active,
  committed,
  moves,
  validMoves,
  winner,
}: {
  player?: Player;
  side: "left" | "right";
  score: number;
  active: boolean;
  committed: boolean;
  moves: string[];
  validMoves: string[];
  winner: boolean;
}) {
  return (
    <div className={cx("sd-duelist", side, active && "active", winner && "winner")}>
      <div className="sd-agent-name">{player?.name ?? "Awaiting agent"}</div>
      <div className="sd-wallet">{shortHash(player?.walletAddress) || player?.id || "wallet pending"}</div>
      <div className="sd-agent-score">{score}</div>
      <div className="sd-token-row">
        {(["rock", "paper", "scissors"] as const).map((move) => (
          <span className={cx("sd-token", validMoves.includes(move) && "live")} key={move}>{moveGlyph[move]}</span>
        ))}
      </div>
      <div className="sd-mini">
        <span>{committed ? "commit hidden" : active ? "awaiting action" : "standing by"}</span>
        <span>played {moves.length ? moves.map((move) => moveGlyph[move as keyof typeof moveGlyph]).join(" · ") : "none"}</span>
      </div>
    </div>
  );
}

function CommitSlot({ player, committed, reveal }: { player?: Player; committed: boolean; reveal?: SignalDuelRoundHistory }) {
  const move = player?.id ? reveal?.moves[player.id] : undefined;
  return (
    <div className={cx("sd-commit-card", move && "revealed", committed && !move && "sealed")}>
      <span>{player?.name ?? "agent"}</span>
      <b>{move ? moveGlyph[move] : committed ? "HIDDEN" : "OPEN"}</b>
    </div>
  );
}

function RoundPips({ round, total, history }: { round: number; total: number; history: SignalDuelRoundHistory[] }) {
  return (
    <div className="sd-pips">
      {Array.from({ length: total }, (_, index) => {
        const roundNo = index + 1;
        const done = history.some((item) => item.round === roundNo);
        return <span className={cx(done && "done", roundNo === round && "current")} key={roundNo} />;
      })}
    </div>
  );
}

function SignalSettlement({ ui, receipt, winner }: { ui?: MatchUiResponse; receipt?: MatchReceipt; winner?: string }) {
  const data = ui?.render.data;
  const funding = receipt?.fundingTxHashes ?? data?.fundingTxHashes ?? [];
  const settlementTx = receipt?.payoutTxHash ?? receipt?.refundTxHashes?.map((tx) => tx.txHash).join(" / ");
  return (
    <div className="evidence-grid">
      <EvidenceRow label="Outcome" value={receipt?.outcome ?? (winner ? "winner pending receipt" : "pending")} tone={receipt ? "good" : "warn"} />
      <EvidenceRow label="PrizePool" value={receipt?.prizePoolAddress ?? data?.prizePoolAddress ?? "pending"} mono />
      <EvidenceRow label="Rulebook hash" value={receipt?.rulesHash ?? data?.rulesHash ?? "pending"} mono tone={receipt?.rulesHash || data?.rulesHash ? "good" : "warn"} />
      <EvidenceRow label="Archive" value={receipt?.archiveHash ? shortHash(receipt.archiveHash) : "pending"} mono tone={receipt?.archiveHash ? "good" : "warn"} />
      <EvidenceRow label={receipt?.outcome === "draw" ? "Refund tx" : "Payout tx"} value={settlementTx ? shortHash(settlementTx) : "pending"} mono tone={settlementTx ? "good" : "warn"} />
      <EvidenceRow label="Pool funded" value={receipt || data?.fullyFunded ? "true" : "pending"} tone={receipt || data?.fullyFunded ? "good" : "warn"} />
      {data?.prizePoolError ? <StatusBanner tone="bad" label="PrizePool read failure" value={data.prizePoolError} /> : null}
      <div className="tx-list">
        <h3>Funding transactions</h3>
        {funding.length === 0 ? <EmptyState text="Funding transaction hashes pending from backend." /> : null}
        {funding.map((tx) => <FundingRow key={`${tx.playerId}-${tx.txHash}`} tx={tx} />)}
      </div>
    </div>
  );
}

function commitSubmitted(pending: Array<{ playerId: string; submitted: boolean }>, playerId?: string): boolean {
  return Boolean(playerId && pending.find((item) => item.playerId === playerId)?.submitted);
}

function playedMoves(history: SignalDuelRoundHistory[], playerId?: string): string[] {
  if (!playerId) {
    return [];
  }
  return history.map((round) => round.moves[playerId]).filter(Boolean);
}
