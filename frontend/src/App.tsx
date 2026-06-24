import { useEffect, useMemo, useRef, useState } from "react";
import {
  createDemoMatch,
  getGameDetail,
  getGames,
  getHealth,
  getLiveMatches,
  getMatchUi,
  startDemoAgents,
  type AgentLog,
  type FundingTxReceipt,
  type GameDetail,
  type GameEngineSummary,
  type MatchReceipt,
  type MatchSummary,
  type MatchUiResponse,
  type Player,
  type RoundSummary,
} from "./api";

type Route =
  | { name: "landing" }
  | { name: "games" }
  | { name: "gameDetail"; id: string }
  | { name: "liveGame"; id: string };

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute());

  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = (to: string) => {
    window.history.pushState(null, "", to);
    setRoute(parseRoute());
  };

  return (
    <main className={route.name === "liveGame" ? "game-shell" : "platform-shell"}>
      {route.name === "landing" ? <LandingPage navigate={navigate} /> : null}
      {route.name === "games" ? <Marketplace navigate={navigate} /> : null}
      {route.name === "gameDetail" ? <GameDetailPage gameId={route.id} navigate={navigate} /> : null}
      {route.name === "liveGame" ? <LiveGamePage matchId={route.id} navigate={navigate} /> : null}
    </main>
  );
}

function LandingPage({ navigate }: { navigate: (to: string) => void }) {
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [liveMatches, setLiveMatches] = useState<MatchSummary[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      try {
        await getHealth();
        const matches = await getLiveMatches();
        if (!stopped) {
          setHealth("online");
          setLiveMatches(matches);
          setError(undefined);
        }
      } catch (err) {
        if (!stopped) {
          setHealth("offline");
          setLiveMatches([]);
          setError(errorMessage(err));
        }
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="landing">
      <div className="landing-hero">
        <div className="eyebrow">Trusted-referee MVP</div>
        <h1>ZeroArena</h1>
        <p>
          Autonomous agents compete in Sovereign Bluff with backend-rendered match state, rulebook
          commitment, 0G archive evidence, and contract payout fields shown only when returned.
        </p>
        <button className="primary" onClick={() => navigate("/games")}>
          Enter Marketplace
        </button>
      </div>

      <aside className="ticker-strip" aria-label="Live match preview">
        <div>
          <span className={health === "online" ? "signal online" : "signal"} />
          Backend {health}
        </div>
        {error ? <strong>{error}</strong> : null}
        {liveMatches.length === 0 && !error ? <strong>No live matches reported.</strong> : null}
        {liveMatches.slice(0, 3).map((match) => (
          <button key={match.matchId} onClick={() => navigate(`/game/${match.matchId}`)}>
            <span>{match.gameId}</span>
            <strong>{match.status}</strong>
            <small>
              {match.matchId} / round {match.round}
            </small>
          </button>
        ))}
      </aside>
    </section>
  );
}

function Marketplace({ navigate }: { navigate: (to: string) => void }) {
  const [games, setGames] = useState<GameEngineSummary[]>([]);
  const [liveMatches, setLiveMatches] = useState<MatchSummary[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      try {
        const [nextGames, nextMatches] = await Promise.all([getGames(), getLiveMatches()]);
        if (!stopped) {
          setGames(nextGames);
          setLiveMatches(nextMatches);
          setError(undefined);
          setLoading(false);
        }
      } catch (err) {
        if (!stopped) {
          setError(errorMessage(err));
          setLoading(false);
        }
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="platform-page">
      <PlatformHeader
        eyebrow="Game marketplace"
        title="Available arenas"
        action={<button className="secondary" onClick={() => navigate("/")}>Back</button>}
      />
      {error ? <StatusBanner tone="bad" label="Backend error" value={error} /> : null}
      {loading ? <StatusBanner tone="warn" label="Loading" value="Reading /games and /matches/live." /> : null}
      <div className="game-grid">
        {games.map((game) => {
          const matches = liveMatches.filter((match) => match.gameId === game.id);
          return (
            <article className="game-card" key={game.id}>
              <div>
                <span className="eyebrow">Deployed game</span>
                <h2>{game.name}</h2>
                <p>{gameDescription(game.id, game.name)}</p>
              </div>
              <div className="game-facts">
                <Metric label="Players" value={`${game.minPlayers}-${game.maxPlayers}`} />
                <Metric label="Active matches" value={String(matches.length)} />
                <Metric label="Rulebook" value={matches.length ? "check live match" : "pending live match"} />
              </div>
              <button className="primary" onClick={() => navigate(`/games/${game.id}`)}>
                View Game
              </button>
            </article>
          );
        })}
      </div>
      {games.length === 0 && !loading ? <EmptyState text="No games returned by /games." /> : null}
    </section>
  );
}

function GameDetailPage({ gameId, navigate }: { gameId: string; navigate: (to: string) => void }) {
  const [detail, setDetail] = useState<GameDetail>();
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);

  const refresh = async () => {
    try {
      setDetail(await getGameDetail(gameId));
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [gameId]);

  const startDemo = async () => {
    setStarting(true);
    try {
      const match = await createDemoMatch();
      void startDemoAgents(match.matchId).catch((err) => setError(`Demo agent runner failed: ${errorMessage(err)}`));
      window.open(`/game/${match.matchId}`, "_blank", "noopener,noreferrer");
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <section className="platform-page">
      <PlatformHeader
        eyebrow="Game detail"
        title={detail?.name ?? gameId}
        action={<button className="secondary" onClick={() => navigate("/games")}>Marketplace</button>}
      />
      {error ? <StatusBanner tone="bad" label="Backend error" value={error} /> : null}
      {!detail ? <StatusBanner tone="warn" label="Loading" value="Reading game detail from backend and catalog adapter." /> : null}
      {detail ? (
        <>
          <section className="detail-band">
            <div>
              <p>{detail.description}</p>
              <div className="detail-actions">
                <button className="secondary" onClick={startDemo} disabled={starting}>
                  {starting ? "Creating..." : "Start Demo Match"}
                </button>
              </div>
            </div>
            <div className="evidence-grid compact">
              <EvidenceRow label="Player count" value={`${detail.minPlayers}-${detail.maxPlayers}`} />
              <EvidenceRow label="Active matches" value={String(detail.activeMatchCount)} />
              <EvidenceRow label="Rulebook status" value={detail.rulebookStatus} tone={detail.rulebookHash ? "good" : "warn"} />
              <EvidenceRow label="Rulebook hash" value={detail.rulebookHash ?? "not exposed by backend"} mono tone={detail.rulebookHash ? "good" : "warn"} />
            </div>
          </section>

          <section className="info-grid">
            <InfoList title="Rules" items={detail.rules} />
            <InfoList title="Instructions" items={detail.instructions} />
            <article className="info-panel">
              <h2>Prize Pool Model</h2>
              <p>{detail.prizePoolModel}</p>
            </article>
          </section>

          <section className="match-section">
            <h2>Active Matches</h2>
            {detail.activeMatches.length === 0 ? <EmptyState text="No active/running matches for this game." /> : null}
            <div className="active-match-list">
              {detail.activeMatches.map((match) => (
                <ActiveMatchCard key={match.matchId} match={match} />
              ))}
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}

function ActiveMatchCard({ match }: { match: MatchSummary }) {
  return (
    <article className="active-match-card">
      <div>
        <strong>{match.matchId}</strong>
        <span>
          {match.players.map((player) => player.name || player.id).join(" vs ") || "players pending"}
        </span>
      </div>
      <div className="match-meta-row">
        <Metric label="Round" value={String(match.round)} />
        <Metric label="Status" value={match.status} />
        <Metric label="Funding/archive/payout" value="open live backend view" />
      </div>
      <button
        className="primary"
        onClick={() => window.open(`/game/${match.matchId}`, "_blank", "noopener,noreferrer")}
      >
        Open Live Game
      </button>
    </article>
  );
}

function LiveGamePage({ matchId, navigate }: { matchId: string; navigate: (to: string) => void }) {
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

  return (
    <section className="live-game-page">
      <nav className="game-nav">
        <button className="secondary" onClick={() => navigate("/games/sovereign-bluff")}>Game Detail</button>
        <span>{matchId}</span>
        <strong>{ui?.status ?? (loading ? "loading" : "pending")}</strong>
      </nav>
      {error ? <StatusBanner tone="bad" label="Polling error" value={error} /> : null}
      {ui?.runnerError ? <StatusBanner tone="bad" label="Agent runner error" value={ui.runnerError} /> : null}
      {loading ? <StatusBanner tone="warn" label="Loading" value="Waiting for /match/:id/ui." /> : null}

      <SovereignBluffStage data={data} players={players} winner={winner} status={ui?.status ?? "waiting"} />

      <section className="game-evidence-layout">
        <div className="game-side">
          <h2>Agents</h2>
          <div className="agent-grid">
            {players.length === 0 ? <EmptyState text="Agent data pending from backend." /> : null}
            {players.map((player) => (
              <AgentCard key={player.id} player={player} latestLog={latestLogs.get(player.id)} winner={winner === player.id} />
            ))}
          </div>
        </div>
        <div className="game-side">
          <h2>Current Round</h2>
          <Broadcasts messages={data?.messages ?? []} players={players} />
          <BidStatus pendingBids={data?.pendingBids ?? []} revealedBids={data?.revealedBids ?? []} players={players} />
        </div>
        <div className="game-side">
          <h2>0G And Payout Evidence</h2>
          <PrizePoolEvidence ui={ui} receipt={receipt} />
        </div>
      </section>

      <section className="game-wide">
        <h2>Round History</h2>
        <RoundHistory history={data?.history ?? []} players={players} />
      </section>
      <section className="game-wide">
        <h2>Final Receipt</h2>
        <FinalReceipt receipt={receipt} winner={winner} status={ui?.status} />
      </section>
    </section>
  );
}

function SovereignBluffStage({
  data,
  players,
  winner,
  status,
}: {
  data?: MatchUiResponse["render"]["data"];
  players: Player[];
  winner?: string;
  status: string;
}) {
  const [left, right] = players;
  const phase = data?.phase ?? "pending";
  const messages = data?.messages ?? [];
  const pendingBids = data?.pendingBids ?? [];
  const revealedBids = data?.revealedBids ?? [];
  const maxBalance = Math.max(100, ...players.map((player) => Number(player.balance) || 0));

  return (
    <section className={`arena-stage phase-${phase} ${winner ? "match-won" : ""}`}>
      <div className="stage-skyline">
        <div className="stage-title">
          <span>Sovereign Bluff</span>
          <strong>
            Round {formatMaybe(data?.round)} of {formatMaybe(data?.totalRounds ?? 5)}
          </strong>
        </div>
        <div className="phase-ribbon">
          <span>{phase}</span>
          <small>{status}</small>
        </div>
      </div>

      <div className="duel-layout">
        <AgentDuelist
          player={left}
          side="left"
          message={latestMessageFor(messages, left?.id)}
          bidSubmitted={bidSubmitted(pendingBids, left?.id)}
          revealedBid={revealedBid(revealedBids, left?.id)}
          maxBalance={maxBalance}
          winner={winner === left?.id}
        />
        <TreasuryPot
          amount={data?.currentTreasury}
          phase={phase}
          status={status}
          winner={winner ? playerName(players, winner) : undefined}
          lastRound={data?.history?.at(-1)}
          players={players}
        />
        <AgentDuelist
          player={right}
          side="right"
          message={latestMessageFor(messages, right?.id)}
          bidSubmitted={bidSubmitted(pendingBids, right?.id)}
          revealedBid={revealedBid(revealedBids, right?.id)}
          maxBalance={maxBalance}
          winner={winner === right?.id}
        />
      </div>

      <RoundTimeline total={Number(data?.totalRounds ?? 5)} current={Number(data?.round ?? 0)} history={data?.history ?? []} />
    </section>
  );
}

function AgentDuelist({
  player,
  side,
  message,
  bidSubmitted,
  revealedBid,
  maxBalance,
  winner,
}: {
  player?: Player;
  side: "left" | "right";
  message?: string;
  bidSubmitted: boolean;
  revealedBid?: number;
  maxBalance: number;
  winner: boolean;
}) {
  const balance = Number(player?.balance) || 0;
  const width = `${Math.max(0, Math.min(100, (balance / maxBalance) * 100))}%`;
  return (
    <article className={`duelist ${side} ${winner ? "winner" : ""}`}>
      <div className="avatar" aria-hidden="true">
        <span>{player?.name?.slice(0, 1) ?? "?"}</span>
      </div>
      <h2>{player?.name ?? "Awaiting agent"}</h2>
      <code>{player?.walletAddress ?? "wallet pending"}</code>
      <div className="balance-track">
        <div className="balance-fill" style={{ width }} />
      </div>
      <strong className="balance-label">{formatMaybe(player?.balance)} tokens</strong>
      <DialogueBubble text={message} side={side} />
      <BidReveal submitted={bidSubmitted} amount={revealedBid} />
    </article>
  );
}

function TreasuryPot({
  amount,
  phase,
  status,
  winner,
  lastRound,
  players,
}: {
  amount?: number;
  phase: string;
  status: string;
  winner?: string;
  lastRound?: RoundSummary;
  players: Player[];
}) {
  return (
    <div className="treasury-pot">
      <span className="pot-label">Treasury</span>
      <strong>{formatMaybe(amount)}</strong>
      <small>{status}</small>
      {winner ? <div className="winner-banner">{winner} wins match</div> : null}
      {!winner && lastRound ? (
        <div className="round-result">
          Round {lastRound.round}: {lastRound.winner ? `${playerName(players, lastRound.winner)} took ${lastRound.treasury}` : "split treasury"}
        </div>
      ) : null}
      <div className="phase-orbit">{phase}</div>
    </div>
  );
}

function DialogueBubble({ text, side }: { text?: string; side: "left" | "right" }) {
  return (
    <div className={`dialogue-bubble ${side}`}>
      {text ? <p>{text}</p> : <p className="muted-line">broadcast pending</p>}
    </div>
  );
}

function BidReveal({ submitted, amount }: { submitted: boolean; amount?: number }) {
  const revealed = amount !== undefined;
  return (
    <div className={`stage-bid ${revealed ? "revealed" : submitted ? "submitted" : ""}`}>
      <span>{revealed ? "revealed bid" : submitted ? "hidden bid locked" : "waiting bid"}</span>
      <strong>{revealed ? amount : submitted ? "??" : "--"}</strong>
    </div>
  );
}

function RoundTimeline({ total, current, history }: { total: number; current: number; history: RoundSummary[] }) {
  return (
    <div className="round-timeline">
      {Array.from({ length: total }, (_, index) => {
        const round = index + 1;
        const done = history.some((item) => item.round === round);
        return (
          <span key={round} className={done ? "done" : round === current ? "active" : ""}>
            {round}
          </span>
        );
      })}
    </div>
  );
}

function AgentCard({ player, latestLog, winner }: { player: Player; latestLog?: AgentLog; winner: boolean }) {
  const mode = latestLog?.inferenceMode ?? player.inferenceMode ?? player.agentKind ?? "pending";
  return (
    <article className={`agent-card ${winner ? "winner" : ""}`}>
      <div className="agent-top">
        <div>
          <h3>{player.name || player.id}</h3>
          <small>{player.id}</small>
        </div>
        <span className={mode === "0g-serving" ? "pill good" : "pill warn"}>{mode}</span>
      </div>
      <EvidenceRow label="Wallet" value={player.walletAddress || "pending"} mono />
      <EvidenceRow label="Balance" value={formatMaybe(player.balance)} />
      <EvidenceRow label="Provider" value={latestLog?.provider ?? "pending"} />
      <EvidenceRow label="Model" value={latestLog?.model ?? "pending"} />
      <EvidenceRow label="Last latency" value={latestLog ? `${latestLog.latencyMs} ms` : "pending"} />
      {latestLog?.fallbackReason ? <StatusBanner tone="warn" label="Fallback" value={latestLog.fallbackReason} /> : null}
    </article>
  );
}

function PrizePoolEvidence({ ui, receipt }: { ui?: MatchUiResponse; receipt?: MatchReceipt }) {
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
      <EvidenceRow label="Rulebook hash" value={rulesHash ?? "pending from backend"} mono tone={rulesHash ? "good" : "warn"} />
      <EvidenceRow label="Rulebook version" value={receipt?.rulesVersion ?? "pending until receipt"} tone={receipt?.rulesVersion ? "good" : "warn"} />
      <EvidenceRow label="Rulebook retrieval" value={receipt?.rulesUrl ?? "pending until final receipt"} mono tone={receipt?.rulesUrl ? "good" : "warn"} />
      <EvidenceRow label="Pool creation tx" value={poolCreation ?? "unavailable from current /ui payload"} mono tone={poolCreation ? "good" : "warn"} />
      <EvidenceRow label="Fully funded" value={fullyFunded === undefined ? "pending from backend" : fullyFunded ? "true" : "false"} tone={fullyFunded ? "good" : "warn"} />
      <EvidenceRow label="Total pool wei" value={receipt?.totalPoolWei ?? data?.totalPoolWei ?? "pending until receipt"} mono />
      <EvidenceRow label="Archive mode" value={receipt?.archiveMode ?? "pending"} tone={receipt?.archiveMode === "0g" ? "good" : receipt?.archiveMode ? "warn" : undefined} />
      {data?.storageError ? <StatusBanner tone="bad" label="Storage failure" value={data.storageError} /> : null}
      {data?.payoutError ? <StatusBanner tone="bad" label="Payout failure" value={data.payoutError} /> : null}
      {data?.prizePoolError ? <StatusBanner tone="bad" label="PrizePool read failure" value={data.prizePoolError} /> : null}
      <div className="tx-list">
        <h3>Funding Transactions</h3>
        {funding.length === 0 ? <EmptyState text="Funding transaction hashes pending from backend." /> : null}
        {funding.map((tx) => (
          <FundingRow key={`${tx.playerId}-${tx.txHash}`} tx={tx} />
        ))}
      </div>
    </div>
  );
}

function Broadcasts({
  messages,
  players,
}: {
  messages: Array<{ playerId: string; round: number; text: string; timestamp: string }>;
  players: Player[];
}) {
  const currentRound = Math.max(0, ...messages.map((message) => message.round));
  const visible = messages.filter((message) => message.round === currentRound).slice(-4);
  return (
    <div className="broadcasts">
      <h3>Broadcasts</h3>
      {visible.length === 0 ? <EmptyState text="No broadcast messages for the current round yet." /> : null}
      {visible.map((message) => (
        <div className="bubble" key={`${message.playerId}-${message.timestamp}`}>
          <strong>{playerName(players, message.playerId)}</strong>
          <p>{message.text}</p>
          <small>
            Round {message.round} / {new Date(message.timestamp).toLocaleTimeString()}
          </small>
        </div>
      ))}
    </div>
  );
}

function BidStatus({
  pendingBids,
  revealedBids,
  players,
}: {
  pendingBids: Array<{ playerId: string; submitted: boolean }>;
  revealedBids: Array<{ playerId: string; amount: number }>;
  players: Player[];
}) {
  const revealed = new Map(revealedBids.map((bid) => [bid.playerId, bid.amount]));
  return (
    <div className="bid-grid">
      <h3>Bids</h3>
      {pendingBids.length === 0 ? <EmptyState text="Bid status pending from backend." /> : null}
      {pendingBids.map((bid) => (
        <div className="bid-card" key={bid.playerId}>
          <span>{playerName(players, bid.playerId)}</span>
          {revealed.has(bid.playerId) ? <strong>Revealed: {revealed.get(bid.playerId)}</strong> : <strong>{bid.submitted ? "Submitted, hidden" : "Waiting for bid"}</strong>}
        </div>
      ))}
    </div>
  );
}

function RoundHistory({ history, players }: { history: RoundSummary[]; players: Player[] }) {
  if (history.length === 0) {
    return <EmptyState text="Round history will appear after the first simultaneous reveal." />;
  }
  return (
    <div className="history-table">
      <div className="table-row table-head">
        <span>Round</span>
        <span>Treasury</span>
        <span>Bids</span>
        <span>Winner</span>
        <span>Balances</span>
      </div>
      {history.map((round) => (
        <div className="table-row" key={round.round}>
          <span>{round.round}</span>
          <span>{round.treasury}</span>
          <span>{formatPlayerMap(round.bids, players)}</span>
          <span>{round.winner ? playerName(players, round.winner) : "split"}</span>
          <span>{formatPlayerMap(round.balancesAfter, players)}</span>
        </div>
      ))}
    </div>
  );
}

function FinalReceipt({ receipt, winner, status }: { receipt?: MatchReceipt; winner?: string; status?: string }) {
  if (!receipt) {
    return (
      <div className="receipt-pending">
        <EvidenceRow label="Winner" value={winner ?? "pending"} />
        <EvidenceRow label="Receipt status" value={status ?? "pending"} />
        <EmptyState text="Final receipt is pending. Archive hash, payout tx, and inference summary will stay empty until the backend returns them." />
      </div>
    );
  }
  return (
    <div className="receipt-grid">
      <EvidenceRow label="Match ID" value={receipt.matchId} mono />
      <EvidenceRow label="Winner" value={receipt.winner} />
      <EvidenceRow label="Winner wallet" value={receipt.winnerWalletAddress} mono />
      <EvidenceRow label="0G Storage hash" value={receipt.archiveHash} mono tone={receipt.archiveMode === "0g" ? "good" : "warn"} />
      <EvidenceRow label="Storage retrieval" value={receipt.archiveUrl ?? "Use the 0G storage indexer with this root hash."} mono />
      <EvidenceRow label="Rulebook hash" value={receipt.rulesHash} mono tone="good" />
      <EvidenceRow label="Payout amount wei" value={receipt.payoutAmountWei} mono />
      <EvidenceRow label="Payout tx hash" value={receipt.payoutTxHash ?? "missing"} mono tone={receipt.payoutTxHash ? "good" : "bad"} />
      <EvidenceRow label="Completed" value={receipt.completedAt} />
      <div className="tx-list">
        <h3>Per-Agent Inference Summary</h3>
        {receipt.agentInference.map((item) => (
          <div className="summary-row" key={item.playerId}>
            <strong>{item.playerId}</strong>
            <span className={item.mode === "0g-serving" ? "pill good" : "pill warn"}>{item.mode}</span>
            <span>{item.turns} turns</span>
            <span>{item.fallbackTurns} fallback</span>
            <code>{item.walletAddress}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function InfoList({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="info-panel">
      <h2>{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  );
}

function PlatformHeader({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  return (
    <header className="platform-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
      </div>
      {action}
    </header>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
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
    <div className={`evidence-row ${tone ?? ""}`}>
      <span>{label}</span>
      <strong className={mono ? "mono" : undefined}>{value}</strong>
    </div>
  );
}

function StatusBanner({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" | "bad" }) {
  return (
    <div className={`status-banner ${tone}`}>
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function parseRoute(): Route {
  const live = window.location.pathname.match(/^\/(?:match|game)\/([^/]+)$/);
  if (live) {
    return { name: "liveGame", id: decodeURIComponent(live[1]) };
  }
  const detail = window.location.pathname.match(/^\/games\/([^/]+)$/);
  if (detail) {
    return { name: "gameDetail", id: decodeURIComponent(detail[1]) };
  }
  if (window.location.pathname === "/games") {
    return { name: "games" };
  }
  return { name: "landing" };
}

function latestMessageFor(
  messages: Array<{ playerId: string; round: number; text: string; timestamp: string }>,
  playerId?: string,
): string | undefined {
  if (!playerId) {
    return undefined;
  }
  return [...messages].reverse().find((message) => message.playerId === playerId)?.text;
}

function bidSubmitted(bids: Array<{ playerId: string; submitted: boolean }>, playerId?: string): boolean {
  return Boolean(playerId && bids.find((bid) => bid.playerId === playerId)?.submitted);
}

function revealedBid(bids: Array<{ playerId: string; amount: number }>, playerId?: string): number | undefined {
  return playerId ? bids.find((bid) => bid.playerId === playerId)?.amount : undefined;
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

function latestLogByPlayer(logs: AgentLog[]): Map<string, AgentLog> {
  const latest = new Map<string, AgentLog>();
  for (const log of logs) {
    latest.set(log.playerId, log);
  }
  return latest;
}

function playerName(players: Player[], playerId: string): string {
  return players.find((player) => player.id === playerId)?.name ?? playerId;
}

function formatPlayerMap(values: Record<string, number>, players: Player[]): string {
  return Object.entries(values)
    .map(([id, value]) => `${playerName(players, id)} ${value}`)
    .join(" / ");
}

function formatMaybe(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "pending";
  }
  return String(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function gameDescription(gameId: string, name: string): string {
  if (gameId === "sovereign-bluff") {
    return "Five rounds of broadcasts, hidden bids, treasury swings, and final payout evidence.";
  }
  return `${name} is listed by the backend registry. Extra metadata is not exposed yet.`;
}
