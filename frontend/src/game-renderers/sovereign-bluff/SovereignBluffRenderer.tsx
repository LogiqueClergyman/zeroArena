import { useEffect, useState } from "react";
import type { AgentLog, FundingTxReceipt, MatchReceipt, MatchUiResponse, Player, RoundSummary } from "../../api";
import type { GameRendererProps } from "../types";
import "./sovereign-bluff.css";

/* ===== Sovereign Bluff-local helpers & primitives — owned by this renderer, shared with no other game ===== */

function cx(...values: Array<string | false | undefined | null>): string {
  return values.filter(Boolean).join(" ");
}

function initials(name?: string): string {
  if (!name) {
    return "??";
  }
  const trimmed = name.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

function shortId(value: string): string {
  if (!value) {
    return "—";
  }
  return value.length <= 10 ? value : `#${value.slice(-6)}`;
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

function formatMaybe(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "pending";
  }
  return String(value);
}

function playerName(players: Player[], playerId: string): string {
  return players.find((player) => player.id === playerId)?.name ?? playerId;
}

function formatPlayerMap(values: Record<string, number>, players: Player[]): string {
  return Object.entries(values)
    .map(([id, value]) => `${playerName(players, id)} ${value}`)
    .join(" / ");
}

function roundResultLabel(round: RoundSummary | undefined, players: Player[]): string {
  if (!round) {
    return "Reveal pending";
  }
  if (!round.winner) {
    return `Round ${round.round}: treasury rolls over`;
  }
  return `Round ${round.round}: ${playerName(players, round.winner)} takes ${round.treasury}`;
}

function toRoman(value: number): string {
  if (!value || value < 1) {
    return "I";
  }
  const table: Array<[number, string]> = [
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let remaining = value;
  let result = "";
  for (const [num, sym] of table) {
    while (remaining >= num) {
      result += sym;
      remaining -= num;
    }
  }
  return result;
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

const EMBERS = [
  { left: "12%", bottom: "8%", size: 3, color: "#F0B45C", glow: "rgba(240,180,92,0.6)", dur: "7s", delay: "0s" },
  { left: "24%", bottom: "4%", size: 2, color: "#F7D08A", glow: "rgba(247,208,138,0.5)", dur: "9s", delay: "1.5s" },
  { left: "38%", bottom: "10%", size: 2, color: "#fff", glow: "rgba(255,255,255,0.4)", dur: "8s", delay: "3s" },
  { left: "62%", bottom: "6%", size: 2, color: "#9FC0FF", glow: "rgba(125,162,255,0.5)", dur: "8.5s", delay: "0.8s" },
  { left: "76%", bottom: "9%", size: 3, color: "#7DA2FF", glow: "rgba(125,162,255,0.5)", dur: "10s", delay: "2.2s" },
  { left: "88%", bottom: "5%", size: 2, color: "#F0B45C", glow: "rgba(240,180,92,0.5)", dur: "7.5s", delay: "4s" },
];

export function SovereignBluffRenderer(props: GameRendererProps) {
  const { match: ui, ui: data, players, winner, receipt, latestLogs, matchId, navigate, error, loading } = props;
  const status = ui?.status ?? "waiting";
  const [left, right] = players;
  const totalRounds = Number(data?.totalRounds ?? 5);
  const round = Number(data?.round ?? 0);
  const history = data?.history ?? [];
  const phase = data?.phase ?? "pending";
  const pendingBids = data?.pendingBids ?? [];

  // Local state to hold the reveal card flip
  const [localReveal, setLocalReveal] = useState<{ round: number; leftBid: number; rightBid: number; result: RoundSummary | undefined } | null>(null);

  useEffect(() => {
    // When history length increases, it means a round just finished.
    // Trigger a temporary reveal phase on the frontend.
    if (history.length > 0) {
      const lastRound = history[history.length - 1];
      // Only trigger if we haven't already revealed this round and the game isn't over yet
      if (!localReveal || localReveal.round !== lastRound.round) {
        if (!winner && phase !== "finished") {
           setLocalReveal({
             round: lastRound.round,
             leftBid: lastRound.bids[left?.id ?? ""] ?? 0,
             rightBid: lastRound.bids[right?.id ?? ""] ?? 0,
             result: lastRound,
           });
           
           // Clear reveal after 4.5 seconds
           const timer = setTimeout(() => {
             setLocalReveal(null);
           }, 4500);
           return () => clearTimeout(timer);
        }
      }
    }
  }, [history.length, winner, phase, left?.id, right?.id]);

  const balLeft = Number(left?.balance) || 0;
  const balRight = Number(right?.balance) || 0;
  const leader = balLeft === balRight ? undefined : balLeft > balRight ? left?.id : right?.id;

  // Determine what bids to show. Prioritize local reveal timer, otherwise use backend state.
  let leftBid: number | undefined = undefined;
  let rightBid: number | undefined = undefined;
  let reveal = false;
  let currentTreasury = formatMaybe(data?.currentTreasury);

  if (localReveal) {
    reveal = true;
    leftBid = localReveal.leftBid;
    rightBid = localReveal.rightBid;
    currentTreasury = formatMaybe(localReveal.result?.treasury); // show the treasury being won
  } else if (data?.revealedBids && data.revealedBids.length > 0) {
    reveal = true;
    leftBid = data.revealedBids.find(b => b.playerId === left?.id)?.amount;
    rightBid = data.revealedBids.find(b => b.playerId === right?.id)?.amount;
  }

  // Determine phase label
  const phaseLabel = winner
    ? "Match settled"
    : localReveal
      ? "THE REVEAL"
      : phase === "broadcast"
        ? "The agents posture"
        : phase === "bid" || phase === "commit"
          ? "Sealed bids committed"
          : reveal
            ? "The reveal"
            : formatMaybe(phase);

  // Tab State
  const [activeTab, setActiveTab] = useState<"log" | "agents" | "settlement" | null>("log");

  const toggleTab = (tab: "log" | "agents" | "settlement") => {
    setActiveTab((prev) => (prev === tab ? null : tab));
  };

  return (
    <div className="sb-game">
      <div className="bluff-arena">
        <div className="vignette" />
        <div className="horizon" />
        <div className="embers">
          {EMBERS.map((e, index) => (
            <span
              key={index}
              className="ember"
              style={{
                left: e.left,
                bottom: e.bottom,
                width: e.size,
                height: e.size,
                background: e.color,
                boxShadow: `0 0 ${e.size * 3}px ${e.size}px ${e.glow}`,
                animationDuration: e.dur,
                animationDelay: e.delay,
              }}
            />
          ))}
        </div>

        <div className="bluff-inner">
          <div className="bluff-top">
            <div className="bluff-top-left">
              <button className="bluff-crumb" onClick={() => navigate("/games/sovereign-bluff")}>
                Sovereign Bluff ›
              </button>
              <span className={cx("pill", status === "failed" ? "bad" : "hot")}>
                <span className="dot sm rose blink" />
                {status.toUpperCase()}
              </span>
              <span className="bluff-table-id">table {shortId(matchId)}</span>
            </div>
            <div className="bluff-controls">
              <button className="cinzel-btn gold" onClick={() => navigate("/games/sovereign-bluff")}>
                DETAIL
              </button>
              <button className="cinzel-btn ghost" onClick={() => navigate("/games")}>
                ARENA
              </button>
            </div>
          </div>

          <div className="bluff-title-wrap">
            <h1 className="bluff-title">SOVEREIGN BLUFF</h1>
            <div className="bluff-sub">
              ROUND {toRoman(localReveal ? localReveal.round : (round || 1))} OF {toRoman(totalRounds)} · {phaseLabel.toUpperCase()}
            </div>
          </div>

          <div className="round-pips">
            {Array.from({ length: totalRounds }, (_, index) => {
              const roundNo = index + 1;
              const done = history.find((item) => item.round === roundNo);
              const isCurrent = roundNo === (localReveal ? localReveal.round : round);
              const color = done
                ? done.winner
                  ? done.winner === left?.id
                    ? "var(--amber)"
                    : "var(--peri)"
                  : "var(--dim)"
                : "#ffffff";
              const fill = done ? 0.85 : isCurrent ? 0.4 : 0.06;
              return (
                <div className="pip" key={roundNo}>
                  <i style={{ background: color, opacity: fill, boxShadow: `0 0 10px ${color}` }} />
                </div>
              );
            })}
          </div>

          <div className="bluff-stage">
            <Champion
              player={left}
              side="amber"
              balance={formatMaybe(localReveal ? localReveal.result?.balancesAfter[left?.id ?? ""] : left?.balance)}
              thinking={!localReveal && bidSubmitted(pendingBids, left?.id) && leftBid === undefined}
              leading={leader === left?.id}
              won={winner === left?.id}
            />

            <div className="altar">
              <div className="altar-label">ROUND TREASURY</div>
              <div className="treasury-altar">
                <span className="gem" />
                <b>{currentTreasury}</b>
              </div>
              <div className="bid-cards">
                <BidCard label={(left?.name ?? "Alpha").toUpperCase()} side="amber" amount={leftBid} sealed={!reveal} />
                <span className="bid-sep">✦</span>
                <BidCard label={(right?.name ?? "Beta").toUpperCase()} side="blue" amount={rightBid} sealed={!reveal} />
              </div>
              <div className="reveal-row">
                {winner ? (
                  <div className={cx("reveal-banner", winner === left?.id ? "amber" : winner === right?.id ? "blue" : "")}>
                    {playerName(players, winner)} claims the crown
                  </div>
                ) : reveal ? (
                  <div className="reveal-banner">{roundResultLabel(localReveal ? localReveal.result : history.at(-1), players)}</div>
                ) : (
                  <div className="sealed-note">Bids sealed — the reveal approaches</div>
                )}
              </div>
            </div>

            <Champion
              player={right}
              side="blue"
              balance={formatMaybe(localReveal ? localReveal.result?.balancesAfter[right?.id ?? ""] : right?.balance)}
              thinking={!localReveal && bidSubmitted(pendingBids, right?.id) && rightBid === undefined}
              leading={leader === right?.id}
              won={winner === right?.id}
            />
          </div>

          <div className="bluff-lower">
            <Chronicle messages={data?.messages ?? []} players={players} winner={winner} receipt={receipt} />
            <RiteOfSettlement ui={ui} receipt={receipt} winner={winner} players={players} />
          </div>
        </div>
      </div>

      <section className="evidence-section sb-panels">
        {error ? <StatusBanner tone="bad" label="Polling error" value={error} /> : null}
        {ui?.runnerError ? <StatusBanner tone="bad" label="Agent runner error" value={ui.runnerError} /> : null}
        {loading ? <StatusBanner tone="warn" label="Loading" value="Waiting for match UI payload..." /> : null}

        <div className="game-tabs">
          <button className={cx("game-tab", activeTab === "log" && "active")} onClick={() => toggleTab("log")}>Round Log</button>
          <button className={cx("game-tab", activeTab === "agents" && "active")} onClick={() => toggleTab("agents")}>Agents</button>
          <button className={cx("game-tab", activeTab === "settlement" && "active")} onClick={() => toggleTab("settlement")}>Settlement</button>
        </div>

        <div className="game-tab-content">
          {activeTab === "log" && (
            <RoundHistory history={history} players={players} />
          )}

          {activeTab === "agents" && (
            <div className="agent-grid">
              {players.length === 0 ? <EmptyState text="Agent data pending from backend." /> : null}
              {players.map((player) => (
                <CompactAgentCard key={player.id} player={player} latestLog={latestLogs.get(player.id)} winner={winner === player.id} />
              ))}
            </div>
          )}

          {activeTab === "settlement" && (
            <div className="settlement-panels">
              <article className="data-card">
                <h2>Prize pool evidence</h2>
                <PrizePoolEvidence ui={ui} receipt={receipt} />
              </article>
              <article className="data-card mt-4">
                <h2>Final receipt</h2>
                <FinalReceipt receipt={receipt} winner={winner} status={ui?.status} />
              </article>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/* ============================ Internal UI Components ============================ */

function Champion({
  player,
  side,
  balance,
  thinking,
  leading,
  won,
}: {
  player?: Player;
  side: "amber" | "blue";
  balance: string;
  thinking: boolean;
  leading: boolean;
  won: boolean;
}) {
  return (
    <div className="champion">
      <div className="champ-avatar-wrap">
        <div className={cx("champ-aura", side)} />
        <div className={cx("champ-avatar", side, won && "win")}>{initials(player?.name ?? player?.id)}</div>
      </div>
      <div className="champ-name">{player?.name ?? "Awaiting"}</div>
      <div className="champ-handle">{shortHash(player?.walletAddress) || player?.id || "wallet pending"}</div>
      <div className={cx("balance-plaque", side)}>
        <span className={cx("plaque-gem", side)} />
        <span className={cx("plaque-num", side)}>{balance}</span>
      </div>
      <div className="champ-status">
        {thinking ? (
          <span className={cx("sealing", side)}>
            <span className={cx("spinner", side)} />
            <span>sealing bid…</span>
          </span>
        ) : leading && !won ? (
          <span className="ascendant">▲ ASCENDANT</span>
        ) : null}
      </div>
    </div>
  );
}

function BidCard({ label, side, amount, sealed }: { label: string; side: "amber" | "blue"; amount?: number; sealed: boolean }) {
  const showFace = !sealed && amount !== undefined;
  return (
    <div className="bid-col">
      {showFace ? (
        <div className={cx("bid-card", "face", side)}>
          <span>{amount}</span>
        </div>
      ) : (
        <div className={cx("bid-card", "back", side)}>
          <span className="rune">
            <i />
          </span>
        </div>
      )}
      <span className={cx("lbl", side)}>{label}</span>
    </div>
  );
}

function Chronicle({ messages, players, winner, receipt }: { messages: Array<{ playerId: string; round: number; text: string; timestamp: string }>; players: Player[]; winner?: string; receipt?: MatchReceipt }) {
  const [left] = players;
  const visible = messages.slice(-12);
  return (
    <div className="chronicle">
      <div className="chronicle-head">
        <span>The Chronicle</span>
        <span className="chan">broadcast channel</span>
      </div>
      <div className="chronicle-feed sx">
        {visible.length === 0 ? <EmptyState text="No broadcast messages returned by the backend yet." /> : null}
        {visible.map((message) => {
          const tone = message.playerId === left?.id ? "amber" : "blue";
          return (
            <div className="cmsg" key={`${message.playerId}-${message.timestamp}`}>
              <span className={cx("chip", tone)}>{initials(playerName(players, message.playerId))}</span>
              <div>
                <div className={cx("who", tone)}>
                  {playerName(players, message.playerId)} · round {message.round}
                </div>
                <div className="text">{message.text}</div>
              </div>
            </div>
          );
        })}
        {receipt ? (
          <div className="cmsg">
            <span className="chip sys">✓</span>
            <div>
              <div className="who sys">Settlement</div>
              <div className="text sys">
                {winner ? `${playerName(players, winner)} settled on-chain.` : "Draw refund settled on-chain."}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RiteOfSettlement({ ui, receipt, winner, players }: { ui?: MatchUiResponse; receipt?: MatchReceipt; winner?: string; players: Player[] }) {
  const data = ui?.render.data;
  const archive = receipt?.archiveHash;
  const pool = receipt?.totalPoolWei ?? data?.totalPoolWei ?? data?.stakeWei;
  const payout = receipt?.payoutTxHash ?? receipt?.refundTxHashes?.map((tx) => tx.txHash).filter(Boolean).join(" / ");
  return (
    <div className="rite">
      <div className="rite-head">Rite of Settlement</div>
      <div className="rite-rows">
        <div className="rite-row">
          <span className="k">Bid integrity</span>
          <span className="v green">✓ sealed · refereed</span>
        </div>
        <div className="rite-row">
          <span className="k">0G archive</span>
          <span className="v">{archive ? shortHash(archive) : "pending"}</span>
        </div>
        <div className="rite-row">
          <span className="k">Prize pool</span>
          <span className="v amber">{pool ?? "pending"}</span>
        </div>
        <div className="rite-hr" />
        {receipt ? (
          <div className="rite-box done">
            <div className="tag">✓ SETTLED ON-CHAIN</div>
            <div className="big">{winner ? `${playerName(players, winner)} wins` : "Draw — both stakes refunded"}</div>
            <div className="small">
              {receipt.payoutAmountWei ? `Paid ${receipt.payoutAmountWei} wei · ` : ""}
              {payout ? `tx ${shortHash(payout)}` : "settlement tx not returned"}
            </div>
          </div>
        ) : (
          <div className="rite-box pending">
            <div className="tag">⏳ ESCROW LOCKED</div>
            <div className="small">
              Pool releases to the verified winner once the backend returns the final receipt.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function bidSubmitted(bids: Array<{ playerId: string; submitted: boolean }>, playerId?: string): boolean {
  return Boolean(playerId && bids.find((bid) => bid.playerId === playerId)?.submitted);
}

/* ============================ Info Tab Components ============================ */

function RoundHistory({ history, players }: { history: RoundSummary[]; players: Player[] }) {
  if (history.length === 0) {
    return <EmptyState text="Round history will appear after the first simultaneous reveal." />;
  }
  return (
    <div className="history-table data-card">
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
      <div className="tx-list mt-4">
        <h3>Funding transactions</h3>
        {funding.length === 0 ? <EmptyState text="Funding transaction hashes pending from backend." /> : null}
        {funding.map((tx: any) => (
          <FundingRow key={`${tx.playerId}-${tx.txHash}`} tx={tx} />
        ))}
      </div>
    </div>
  );
}

function FinalReceipt({ receipt, winner, status }: { receipt?: MatchReceipt; winner?: string; status?: string }) {
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
      <EvidenceRow label="0G Storage hash" value={receipt.archiveHash} mono tone={receipt.archiveMode === "0g" ? "good" : "warn"} />
      <EvidenceRow label="Storage retrieval" value={receipt.archiveUrl ?? "Use the 0G storage indexer with this root hash."} mono />
      <EvidenceRow label="Rulebook hash" value={receipt.rulesHash} mono tone="good" />
      <EvidenceRow label="Payout amount wei" value={receipt.payoutAmountWei ?? "none - draw refund"} mono />
      <EvidenceRow label="Payout tx hash" value={receipt.payoutTxHash ?? "none - draw refund"} mono tone={receipt.payoutTxHash ? "good" : receipt.outcome === "draw" ? "warn" : "bad"} />
      <EvidenceRow label="Refund amount wei" value={receipt.refundAmountWei ?? "none"} mono tone={receipt.refundAmountWei ? "good" : undefined} />
      <EvidenceRow label="Completed" value={formatTime(receipt.completedAt)} />
      {receipt.refundTxHashes && receipt.refundTxHashes.length > 0 ? (
        <div className="tx-list mt-4">
          <h3>Draw refund transactions</h3>
          {receipt.refundTxHashes.map((tx: any) => (
            <FundingRow key={`${tx.playerId}-${tx.txHash}`} tx={tx} />
          ))}
        </div>
      ) : null}
      <div className="tx-list mt-4">
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
