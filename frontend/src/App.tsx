import { useEffect, useMemo, useRef, useState } from "react";
import {
  createDemoMatch,
  getHealth,
  getLiveMatches,
  getMatchUi,
  startDemoAgents,
  type AgentLog,
  type FundingTxReceipt,
  type MatchReceipt,
  type MatchSummary,
  type MatchUiResponse,
  type Player,
  type RoundSummary,
} from "./api";

type Route = { name: "home" } | { name: "match"; id: string };

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
    <main className="shell">
      {route.name === "home" ? (
        <HomeScreen navigate={navigate} />
      ) : (
        <MatchViewer matchId={route.id} navigate={navigate} />
      )}
    </main>
  );
}

function HomeScreen({ navigate }: { navigate: (to: string) => void }) {
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [liveMatches, setLiveMatches] = useState<MatchSummary[]>([]);
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);

  const refresh = async () => {
    setError(undefined);
    try {
      await getHealth();
      setHealth("online");
      setLiveMatches(await getLiveMatches());
    } catch (err) {
      setHealth("offline");
      setError(errorMessage(err));
      setLiveMatches([]);
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, []);

  const start = async () => {
    setStarting(true);
    setError(undefined);
    try {
      const match = await createDemoMatch();
      void startDemoAgents(match.matchId).catch((err) => {
        setError(`Demo agent runner failed: ${errorMessage(err)}`);
      });
      navigate(`/match/${match.matchId}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <section className="home-grid">
      <div className="panel hero-panel">
        <div className="eyebrow">ZeroArena MVP</div>
        <h1>Live Sovereign Bluff Control</h1>
        <p className="muted">
          Start or open a backend-driven demo match. The browser renders only API state and labels
          mock or missing evidence explicitly.
        </p>
        <div className="action-row">
          <button className="primary" onClick={start} disabled={starting || health === "offline"}>
            {starting ? "Creating match..." : "Start demo match"}
          </button>
          <button className="secondary" onClick={() => void refresh()}>
            Refresh status
          </button>
        </div>
        {error ? <StatusBanner tone="bad" label="Backend error" value={error} /> : null}
      </div>

      <div className="panel status-panel">
        <h2>Backend Status</h2>
        <EvidenceRow label="Health" value={health} tone={health === "online" ? "good" : "warn"} />
        <EvidenceRow label="Endpoint" value={import.meta.env.VITE_BACKEND_URL || "/api proxy"} />
        <EvidenceRow label="Live matches" value={String(liveMatches.length)} />
      </div>

      <div className="panel live-panel">
        <h2>Open Matches</h2>
        {liveMatches.length === 0 ? (
          <EmptyState text="No live match reported by the backend." />
        ) : (
          <div className="match-list">
            {liveMatches.map((match) => (
              <div key={match.matchId} className="match-button">
                <button onClick={() => navigate(`/match/${match.matchId}`)}>
                  <span>{match.matchId}</span>
                  <strong>{match.status}</strong>
                  <small>
                    Round {match.round} / {match.gameId}
                  </small>
                </button>
                <button
                  className="open-game-button"
                  onClick={() => window.open(`/match/${match.matchId}`, "_blank", "noopener,noreferrer")}
                >
                  Open live game
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function MatchViewer({ matchId, navigate }: { matchId: string; navigate: (to: string) => void }) {
  const [ui, setUi] = useState<MatchUiResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const startedRef = useRef(false);
  const stableReceiptRef = useRef({ value: "", count: 0 });

  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      void startDemoAgents(matchId).catch((err) => {
        setError(`Demo agent runner failed: ${errorMessage(err)}`);
      });
    }
  }, [matchId]);

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

        if (shouldStopPolling(next, stableReceiptRef.current)) {
          return;
        }
        timer = window.setTimeout(poll, 1000);
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
  const latestLogs = useMemo(() => latestLogByPlayer(ui?.agentLogs ?? []), [ui?.agentLogs]);
  const winner = receipt?.winner ?? data?.winner;

  return (
    <section className="match-page">
      <header className="match-header">
        <div>
          <button className="back-button" onClick={() => navigate("/")}>
            Back
          </button>
          <div className="eyebrow">Match Viewer</div>
          <h1>{matchId}</h1>
        </div>
        <div className="header-stats">
          <Metric label="Status" value={ui?.status ?? (loading ? "loading" : "pending")} />
          <Metric label="Round" value={`${data?.round ?? "-"} / ${data?.totalRounds ?? "-"}`} />
          <Metric label="Treasury" value={formatMaybe(data?.currentTreasury)} />
          <Metric label="Phase" value={data?.phase ?? "pending"} />
        </div>
      </header>

      {error ? <StatusBanner tone="bad" label="Polling error" value={error} /> : null}
      {ui?.runnerError ? <StatusBanner tone="bad" label="Agent runner error" value={ui.runnerError} /> : null}
      {loading ? <StatusBanner tone="warn" label="Loading" value="Waiting for /match/:id/ui." /> : null}

      <SovereignBluffStage
        data={data}
        players={players}
        winner={winner}
        status={ui?.status ?? "waiting"}
      />

      <div className="viewer-grid">
        <section className="panel agents-panel">
          <h2>Agents</h2>
          <div className="agent-grid">
            {players.length === 0 ? <EmptyState text="Agent data pending from backend." /> : null}
            {players.map((player) => (
              <AgentCard
                key={player.id}
                player={player}
                latestLog={latestLogs.get(player.id)}
                winner={winner === player.id}
              />
            ))}
          </div>
        </section>

        <section className="panel prize-panel">
          <h2>Prize Pool And 0G Evidence</h2>
          <PrizePoolEvidence ui={ui} receipt={receipt} />
        </section>

        <section className="panel board-panel">
          <h2>Live Round</h2>
          <Broadcasts messages={data?.messages ?? []} players={players} />
          <BidStatus
            pendingBids={data?.pendingBids ?? []}
            revealedBids={data?.revealedBids ?? []}
            players={players}
          />
        </section>

        <section className="panel history-panel">
          <h2>Round History</h2>
          <RoundHistory history={data?.history ?? []} players={players} />
        </section>

        <section className="panel receipt-panel">
          <h2>Final Receipt</h2>
          <FinalReceipt receipt={receipt} winner={winner} status={ui?.status} />
        </section>
      </div>
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
          <strong>Round {formatMaybe(data?.round)} of {formatMaybe(data?.totalRounds ?? 5)}</strong>
        </div>
        <div className="phase-ribbon">
          <span>{phase}</span>
          <small>broadcast then bid, 5 rounds</small>
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
        return <span key={round} className={done ? "done" : round === current ? "active" : ""}>{round}</span>;
      })}
    </div>
  );
}

function AgentCard({
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
      {latestLog?.fallbackReason ? (
        <StatusBanner tone="warn" label="Fallback" value={latestLog.fallbackReason} />
      ) : null}
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
        value={receipt?.totalPoolWei ?? "pending until receipt"}
        mono
      />
      <EvidenceRow
        label="Archive mode"
        value={receipt?.archiveMode ?? "pending"}
        tone={receipt?.archiveMode === "0g" ? "good" : receipt?.archiveMode ? "warn" : undefined}
      />
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
          {revealed.has(bid.playerId) ? (
            <strong>Revealed: {revealed.get(bid.playerId)}</strong>
          ) : (
            <strong>{bid.submitted ? "Submitted, hidden" : "Waiting for bid"}</strong>
          )}
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

function FinalReceipt({
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
      <EvidenceRow label="Rulebook version" value={receipt.rulesVersion} />
      <EvidenceRow label="Rulebook retrieval" value={receipt.rulesUrl} mono />
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
  const match = window.location.pathname.match(/^\/(?:match|game)\/([^/]+)$/);
  if (match) {
    return { name: "match", id: decodeURIComponent(match[1]) };
  }
  return { name: "home" };
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

function bidSubmitted(
  bids: Array<{ playerId: string; submitted: boolean }>,
  playerId?: string,
): boolean {
  return Boolean(playerId && bids.find((bid) => bid.playerId === playerId)?.submitted);
}

function revealedBid(
  bids: Array<{ playerId: string; amount: number }>,
  playerId?: string,
): number | undefined {
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
