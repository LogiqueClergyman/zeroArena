import { useEffect, useRef, useState } from "react";
import type { AgentLog, MatchReceipt, MatchUiResponse, Player, SignalDuelRoundHistory } from "../api";
import {
  CompactAgentCard,
  cx,
  EmptyState,
  EvidenceRow,
  FundingRow,
  initials,
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

type Move = "rock" | "paper" | "scissors";

const moveLabel: Record<Move, string> = { rock: "ROCK", paper: "PAPER", scissors: "SCISSORS" };
const moveShort: Record<Move, string> = { rock: "R", paper: "P", scissors: "S" };
const MOVES: Move[] = ["rock", "paper", "scissors"];

type InfoTab = "banter" | "reveals" | "agents" | "settlement";

export function SignalDuelLiveScreen(props: LiveProps) {
  const { ui, data, players, winner, receipt, latestLogs, matchId, navigate, error, loading } = props;
  const [left, right] = players;
  const status = ui?.status ?? "waiting";
  const round = Number(data?.round ?? 1);
  const totalRounds = Number(data?.totalRounds ?? 3);
  const phase = data?.phase ?? "pending";
  const scores = data?.scores ?? {};
  const history = data?.roundHistory ?? [];
  const pending = data?.pendingCommits ?? [];
  const currentPlayer = data?.currentPlayer;
  const dialogue = data?.dialogue ?? [];
  const settled = Boolean(receipt);
  const outcome = receipt?.outcome ?? data?.outcome;

  // ----- Card reveal animation -----------------------------------------------
  // When a round resolves, the backend appends to roundHistory and immediately
  // advances to the next round (clearing commits). We hold a short, local reveal
  // window so the just-played moves flip face-up, then flip back to sealed.
  const [revealRound, setRevealRound] = useState<number | null>(null);
  const seenRounds = useRef(history.length);
  useEffect(() => {
    if (history.length > seenRounds.current) {
      const last = history[history.length - 1];
      seenRounds.current = history.length;
      setRevealRound(last.round);
      const timer = setTimeout(() => setRevealRound(null), 3600);
      return () => clearTimeout(timer);
    }
    seenRounds.current = history.length;
  }, [history.length]);

  const revealEntry = revealRound != null ? history.find((entry) => entry.round === revealRound) : undefined;
  const revealing = Boolean(revealEntry);
  const displayRound = revealEntry ? revealEntry.round : round;

  const [tab, setTab] = useState<InfoTab>("banter");

  const leftScore = Number(scores[left?.id ?? ""] ?? 0);
  const rightScore = Number(scores[right?.id ?? ""] ?? 0);

  const phaseMessage = receipt
    ? receipt.outcome === "draw"
      ? "Stalemate — both stakes refunded on-chain"
      : `${playerName(players, receipt.winner ?? winner ?? "")} claims the pool`
    : revealEntry
      ? revealEntry.winner
        ? `${playerName(players, revealEntry.winner)} takes round ${revealEntry.round}`
        : `Round ${revealEntry.round} — mirror match, no point`
      : phase === "dialogue"
        ? `${playerName(players, currentPlayer ?? "")} holds the signal`
        : phase === "commit"
          ? "Commits sealed face-down until both agents lock"
          : "Syncing duel state…";

  return (
    <div className="sd-page">
      <div className="sd-arena">
        <div className="sd-grid-bg" />
        <div className="sd-glow sd-glow-a" />
        <div className="sd-glow sd-glow-b" />

        <div className="sd-inner">
          <header className="sd-top">
            <div className="sd-top-left">
              <button className="sd-crumb" onClick={() => navigate("/games/signal-duel")}>Signal Duel ›</button>
              <span className={cx("sd-status", status === "failed" && "bad", status === "active" && "lit")}>
                <i className="sd-dot" />
                {status.toUpperCase()}
              </span>
              <span className="sd-id">table {shortId(matchId)}</span>
            </div>
            <div className="sd-top-right">
              <button className="sd-btn ghost" onClick={() => navigate("/games/signal-duel")}>DETAIL</button>
              <button className="sd-btn" onClick={() => navigate("/games")}>ARENA</button>
            </div>
          </header>

          {error ? <StatusBanner tone="bad" label="Polling error" value={error} /> : null}
          {loading ? <StatusBanner tone="warn" label="Loading" value="Waiting for Signal Duel state…" /> : null}
          {ui?.runnerError ? <StatusBanner tone="bad" label="Agent runner error" value={ui.runnerError} /> : null}

          <section className="sd-headline">
            <div className="sd-headline-text">
              <div className="sd-kicker">Round {displayRound} / {totalRounds} · {revealing ? "reveal" : phase}</div>
              <h1>SIGNAL DUEL</h1>
              <p>Hidden commits. Public pressure. No inventory hints.</p>
            </div>
            <div className="sd-scoreboard">
              <ScoreChip name={left?.name || shortHash(left?.id) || "Alpha"} score={leftScore} side="pink" win={winner === left?.id} />
              <span className="sd-score-sep">vs</span>
              <ScoreChip name={right?.name || shortHash(right?.id) || "Beta"} score={rightScore} side="gold" win={winner === right?.id} />
            </div>
          </section>

          <RoundPips round={displayRound} total={totalRounds} history={history} left={left?.id} right={right?.id} />

          <section className="sd-stage">
            <Duelist
              player={left}
              side="pink"
              score={leftScore}
              thinking={currentPlayer === left?.id && !settled && !revealing}
              committed={commitSubmitted(pending, left?.id)}
              validMoves={data?.validMovesByPlayer?.[left?.id ?? ""] ?? []}
              history={history}
              winner={winner === left?.id}
            />

            <div className="sd-center">
              <div className={cx("sd-signal", revealing && "fire")}>
                <span className="sd-signal-wave" />
              </div>

              <div className="sd-cards">
                <CommitCard
                  player={left}
                  side="pink"
                  committed={commitSubmitted(pending, left?.id)}
                  move={left?.id ? revealEntry?.moves[left.id] : undefined}
                  revealing={revealing}
                  won={Boolean(revealEntry?.winner && revealEntry.winner === left?.id)}
                  tie={revealing && !revealEntry?.winner}
                />
                <div className={cx("sd-versus", revealing && "hot")}>VS</div>
                <CommitCard
                  player={right}
                  side="gold"
                  committed={commitSubmitted(pending, right?.id)}
                  move={right?.id ? revealEntry?.moves[right.id] : undefined}
                  revealing={revealing}
                  won={Boolean(revealEntry?.winner && revealEntry.winner === right?.id)}
                  tie={revealing && !revealEntry?.winner}
                />
              </div>

              <div
                className={cx(
                  "sd-phase",
                  revealing && (revealEntry?.winner ? "win" : "tie"),
                  receipt && (outcome === "draw" ? "tie" : "win"),
                )}
              >
                {phaseMessage}
              </div>
            </div>

            <Duelist
              player={right}
              side="gold"
              score={rightScore}
              thinking={currentPlayer === right?.id && !settled && !revealing}
              committed={commitSubmitted(pending, right?.id)}
              validMoves={data?.validMovesByPlayer?.[right?.id ?? ""] ?? []}
              history={history}
              winner={winner === right?.id}
            />
          </section>
        </div>
      </div>

      <section className="sd-info">
        <div className="sd-tabs">
          <TabButton active={tab === "banter"} onClick={() => setTab("banter")} label="Duel Banter" count={dialogue.length} />
          <TabButton active={tab === "reveals"} onClick={() => setTab("reveals")} label="Reveals" count={history.length} />
          <TabButton active={tab === "agents"} onClick={() => setTab("agents")} label="Agents" count={players.length} />
          <TabButton active={tab === "settlement"} onClick={() => setTab("settlement")} label="Settlement" />
        </div>

        <div className="sd-tab-body">
          {tab === "banter" ? <BanterFeed dialogue={dialogue} players={players} leftId={left?.id} /> : null}
          {tab === "reveals" ? <RevealStrip history={history} players={players} leftId={left?.id} rightId={right?.id} /> : null}
          {tab === "agents" ? (
            <div className="sd-agent-grid">
              {players.length === 0 ? <EmptyState text="Agent data pending from backend." /> : null}
              {players.map((player) => (
                <CompactAgentCard key={player.id} player={player} latestLog={latestLogs.get(player.id)} winner={winner === player.id} />
              ))}
            </div>
          ) : null}
          {tab === "settlement" ? <SignalSettlement ui={ui} receipt={receipt} winner={winner} /> : null}
        </div>
      </section>
    </div>
  );
}

function ScoreChip({ name, score, side, win }: { name: string; score: number; side: "pink" | "gold"; win: boolean }) {
  return (
    <div className={cx("sd-score", side, win && "win")}>
      <span className="sd-score-name">{name}</span>
      <b className="sd-score-num">{score}</b>
    </div>
  );
}

function TabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button className={cx("sd-tab", active && "active")} onClick={onClick}>
      {label}
      {count !== undefined ? <span className="sd-tab-count">{count}</span> : null}
    </button>
  );
}

function Duelist({
  player,
  side,
  score,
  thinking,
  committed,
  validMoves,
  history,
  winner,
}: {
  player?: Player;
  side: "pink" | "gold";
  score: number;
  thinking: boolean;
  committed: boolean;
  validMoves: string[];
  history: SignalDuelRoundHistory[];
  winner: boolean;
}) {
  const status = committed ? "commit sealed" : thinking ? "deliberating" : "standing by";
  return (
    <div className={cx("sd-duelist", side, thinking && "active", winner && "winner")}>
      <div className="sd-duelist-head">
        <div className={cx("sd-avatar", side, winner && "win")}>{initials(player?.name ?? player?.id)}</div>
        <div className="sd-duelist-id">
          <div className="sd-agent-name">{player?.name ?? "Awaiting agent"}</div>
          <div className="sd-wallet">{shortHash(player?.walletAddress) || player?.id || "wallet pending"}</div>
        </div>
      </div>

      <div className="sd-score-plate">
        <span className="sd-plate-label">score</span>
        <span className="sd-plate-num">{score}</span>
      </div>

      <div className="sd-token-row">
        {MOVES.map((move) => {
          const live = validMoves.includes(move);
          const played = playedCount(history, player?.id, move);
          return (
            <div className={cx("sd-token", live ? "lit" : "spent")} key={move}>
              <span className="sd-token-glyph">{moveShort[move]}</span>
              <span className="sd-token-label">{moveLabel[move]}</span>
              {played > 0 ? <span className="sd-token-played">×{played} played</span> : null}
            </div>
          );
        })}
      </div>

      <div className={cx("sd-duelist-status", thinking && "lit")}>
        {thinking ? <i className="sd-spinner" /> : null}
        <span>{status}</span>
      </div>
    </div>
  );
}

function CommitCard({
  player,
  side,
  committed,
  move,
  revealing,
  won,
  tie,
}: {
  player?: Player;
  side: "pink" | "gold";
  committed: boolean;
  move?: Move;
  revealing: boolean;
  won: boolean;
  tie: boolean;
}) {
  const flipped = revealing && Boolean(move);
  const sealed = committed && !flipped;
  return (
    <div className={cx("sd-card", side, flipped && "flip", sealed && "sealed", won && "won", tie && "tie")}>
      <div className="sd-card-tag">{player?.name ?? "agent"}</div>
      <div className="sd-card-frame">
        <div className="sd-card-inner">
          <div className="sd-card-face front">
            <span className="sd-card-mark">{committed ? "◆" : "○"}</span>
            <span className="sd-card-state">{committed ? "SEALED" : "OPEN"}</span>
          </div>
          <div className="sd-card-face back">
            <span className="sd-card-glyph">{move ? moveShort[move] : "?"}</span>
            <span className="sd-card-move">{move ? moveLabel[move] : ""}</span>
          </div>
        </div>
      </div>
      <div className="sd-card-result">{flipped ? (won ? "WINS" : tie ? "TIE" : "—") : " "}</div>
    </div>
  );
}

function RoundPips({
  round,
  total,
  history,
  left,
  right,
}: {
  round: number;
  total: number;
  history: SignalDuelRoundHistory[];
  left?: string;
  right?: string;
}) {
  return (
    <div className="sd-pips">
      {Array.from({ length: total }, (_, index) => {
        const roundNo = index + 1;
        const done = history.find((item) => item.round === roundNo);
        const tone = done ? (done.winner === left ? "pink" : done.winner === right ? "gold" : "tie") : undefined;
        return (
          <div className={cx("sd-pip", done && "done", roundNo === round && "current", tone)} key={roundNo}>
            <span className="sd-pip-num">{roundNo}</span>
            <i className="sd-pip-bar" />
          </div>
        );
      })}
    </div>
  );
}

function BanterFeed({ dialogue, players, leftId }: { dialogue: Array<{ playerId: string; round: number; turn: number; message: string }>; players: Player[]; leftId?: string }) {
  const visible = dialogue.slice(-14);
  return (
    <div className="sd-banter">
      {visible.length === 0 ? <EmptyState text="Dialogue appears here when the first agent speaks." /> : null}
      {visible.map((line, index) => {
        const tone = line.playerId === leftId ? "pink" : "gold";
        return (
          <div className={cx("sd-banter-line", tone)} key={`${line.round}-${line.turn}-${index}`}>
            <span className={cx("sd-banter-chip", tone)}>{initials(playerName(players, line.playerId))}</span>
            <div className="sd-banter-body">
              <div className="sd-banter-meta">{playerName(players, line.playerId)} · R{line.round}.{line.turn}</div>
              <p className="sd-banter-text">{line.message}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RevealStrip({
  history,
  players,
  leftId,
  rightId,
}: {
  history: SignalDuelRoundHistory[];
  players: Player[];
  leftId?: string;
  rightId?: string;
}) {
  if (history.length === 0) {
    return <EmptyState text="Reveals stay empty until both commits resolve a round." />;
  }
  return (
    <div className="sd-reveal-strip">
      {history.map((entry) => {
        const leftMove = leftId ? entry.moves[leftId] : undefined;
        const rightMove = rightId ? entry.moves[rightId] : undefined;
        return (
          <div className={cx("sd-reveal-card", !entry.winner && "tie")} key={entry.round}>
            <div className="sd-reveal-round">R{entry.round}</div>
            <div className="sd-reveal-moves">
              <span className="sd-reveal-move pink">{leftMove ? moveLabel[leftMove] : "—"}</span>
              <span className="sd-reveal-vs">/</span>
              <span className="sd-reveal-move gold">{rightMove ? moveLabel[rightMove] : "—"}</span>
            </div>
            <strong className="sd-reveal-winner">{entry.winner ? playerName(players, entry.winner) : "tie"}</strong>
          </div>
        );
      })}
    </div>
  );
}

function SignalSettlement({ ui, receipt, winner }: { ui?: MatchUiResponse; receipt?: MatchReceipt; winner?: string }) {
  const data = ui?.render.data;
  const funding = receipt?.fundingTxHashes ?? data?.fundingTxHashes ?? [];
  const settlementTx = receipt?.payoutTxHash ?? receipt?.refundTxHashes?.map((tx) => tx.txHash).join(" / ");
  return (
    <div className="sd-settlement">
      <div className="sd-evidence-grid">
        <EvidenceRow label="Outcome" value={receipt?.outcome ?? (winner ? "winner pending receipt" : "pending")} tone={receipt ? "good" : "warn"} />
        <EvidenceRow label="PrizePool" value={receipt?.prizePoolAddress ?? data?.prizePoolAddress ?? "pending"} mono />
        <EvidenceRow label="Rulebook hash" value={receipt?.rulesHash ?? data?.rulesHash ?? "pending"} mono tone={receipt?.rulesHash || data?.rulesHash ? "good" : "warn"} />
        <EvidenceRow label="Archive" value={receipt?.archiveHash ? shortHash(receipt.archiveHash) : "pending"} mono tone={receipt?.archiveHash ? "good" : "warn"} />
        <EvidenceRow label={receipt?.outcome === "draw" ? "Refund tx" : "Payout tx"} value={settlementTx ? shortHash(settlementTx) : "pending"} mono tone={settlementTx ? "good" : "warn"} />
        <EvidenceRow label="Pool funded" value={receipt || data?.fullyFunded ? "true" : "pending"} tone={receipt || data?.fullyFunded ? "good" : "warn"} />
      </div>
      {data?.prizePoolError ? <StatusBanner tone="bad" label="PrizePool read failure" value={data.prizePoolError} /> : null}
      <div className="sd-tx-list">
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

function playedCount(history: SignalDuelRoundHistory[], playerId: string | undefined, move: Move): number {
  if (!playerId) {
    return 0;
  }
  return history.reduce((total, round) => (round.moves[playerId] === move ? total + 1 : total), 0);
}
