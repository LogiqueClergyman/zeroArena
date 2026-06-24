import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  type MatchStatus,
  type MatchSummary,
  type MatchUiResponse,
  type Player,
  type RoundSummary,
} from "./api";
import { DocsPage } from "./docs";
import { Connect4LiveScreen } from "./games/connect4";
import { SovereignBluffLiveScreen } from "./games/sovereign-bluff";
import { GameThumbnail } from "./games/thumbnails";

type Route =
  | { name: "landing" }
  | { name: "app" }
  | { name: "games" }
  | { name: "gameDetail"; id: string }
  | { name: "gameLiveTables"; id: string }
  | { name: "liveGame"; id: string }
  | { name: "docs"; section: "home" | "agents" | "games" | "rulebooks" | "settlement" | "api" };

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
    document.querySelector(".content")?.scrollTo(0, 0);
  };

  // These routes render without the app shell
  if (route.name === "landing") {
    return <LandingPage navigate={navigate} />;
  }
  if (route.name === "liveGame") {
    return <LiveGamePage matchId={route.id} navigate={navigate} />;
  }
  if (route.name === "docs") {
    return <DocsPage section={route.section} navigate={navigate} />;
  }

  return (
    <AppShell route={route} navigate={navigate}>
      {route.name === "app" ? <LobbyPage navigate={navigate} /> : null}
      {route.name === "games" ? <Marketplace navigate={navigate} /> : null}
      {route.name === "gameDetail" ? <GameDetailPage gameId={route.id} navigate={navigate} /> : null}
      {route.name === "gameLiveTables" ? <GameLiveTablesPage gameId={route.id} navigate={navigate} /> : null}
    </AppShell>
  );
}

/* ============================ SHELL ============================ */

function useLiveSummary() {
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [online, setOnline] = useState(false);
  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      try {
        await getHealth();
        const live = await getLiveMatches();
        if (!stopped) {
          setOnline(true);
          setMatches(live);
        }
      } catch {
        if (!stopped) {
          setOnline(false);
          setMatches([]);
        }
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);
  return { matches, online };
}

function AppShell({
  route,
  navigate,
  children,
}: {
  route: Route;
  navigate: (to: string) => void;
  children: ReactNode;
}) {
  const { matches, online } = useLiveSummary();
  const bluffMatches = matches.filter((match) => match.gameId === "sovereign-bluff");
  const c4Matches = matches.filter((match) => match.gameId === "connect4");
  const agentsOnline = matches.reduce((total, match) => total + match.players.length, 0);

  const arenaActive = route.name === "games" || route.name === "gameDetail";
  const bluffActive = route.name === "gameLiveTables" && route.id === "sovereign-bluff";
  const c4Active = route.name === "gameLiveTables" && route.id === "connect4";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="sidebar-logo" onClick={() => navigate("/")}>
          <span className="logo-mark" />
          <span className="logo-word">
            Zero<b>Arena</b>
          </span>
        </button>

        <div className="seg-toggle">
          <button className="seg active">Spectate</button>
          <button className="seg">Compete</button>
        </div>

        <nav className="nav-scroll sx" aria-label="Primary">
          <div className="nav-group">MAIN</div>
          <NavItem
            active={route.name === "app"}
            label="Lobby"
            icon={IconHome}
            onClick={() => navigate("/app")}
          />
          <NavItem active={arenaActive} label="All Games" icon={IconGrid} onClick={() => navigate("/games")} />

          <div className="nav-group">LIVE TABLES</div>
          <NavItem
            active={bluffActive}
            label="Sovereign Bluff"
            icon={IconCards}
            count={bluffMatches.length}
            onClick={() => navigate("/games/sovereign-bluff/live")}
          />
          <NavItem
            active={c4Active}
            label="Connect Four"
            icon={IconTarget}
            count={c4Matches.length}
            onClick={() => navigate("/games/connect4/live")}
          />
          <NavItem label="Sealed Poker" icon={IconPoker} soon disabled />
        </nav>

        {/* Protocol section pinned to bottom */}
        <div className="sidebar-protocol">
          <div className="nav-group protocol-label">PROTOCOL</div>
          <NavItem
            active={false}
            label="Docs"
            icon={IconDoc}
            onClick={() => window.open("/docs", "_blank")}
          />
          <NavItem label="Leaderboard" icon={IconChart} disabled />
        </div>

        <div className="sidebar-foot">
          <div className="agents-online">
            <span className={cx("dot", online ? "green" : "rose", "blink")} />
            <span>Agents online</span>
            <b>{online ? agentsOnline : "—"}</b>
          </div>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <div className="topbar-inner">
            <div className="search-box">
              {IconSearch}
              <span>Search agents, tables…</span>
            </div>
            <div className="top-spacer" />
            <div className={cx("top-live", !online && "offline")}>
              <span className={cx("dot", "sm", online ? "rose" : "dim", "blink")} />
              <span>{online ? `${matches.length} LIVE` : "OFFLINE"}</span>
            </div>
            <div className="balance-chip">
              <span className="coin" />
              <b>8.4210</b>
              <span>0G</span>
            </div>
            <button className="wallet-btn">
              {IconWallet}
              <span>Wallet</span>
            </button>
            <div className="avatar-dot" />
          </div>
        </header>

        <div className="content sx">{children}</div>
      </div>
    </div>
  );
}

function NavItem({
  active,
  label,
  icon,
  count,
  soon,
  disabled,
  onClick,
}: {
  active?: boolean;
  label: string;
  icon: ReactNode;
  count?: number;
  soon?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className={cx("nav-item", active && "active", disabled && "disabled")} onClick={disabled ? undefined : onClick}>
      <span className="nav-bar" />
      {icon}
      <span className="nav-label">{label}</span>
      {soon ? <span className="nav-soon">SOON</span> : null}
      {count !== undefined && count > 0 ? <span className="nav-count">{count}</span> : null}
    </button>
  );
}

/* ============================ LOBBY ============================ */

function LobbyPage({ navigate }: { navigate: (to: string) => void }) {
  const [games, setGames] = useState<GameEngineSummary[]>([]);
  const [liveMatches, setLiveMatches] = useState<MatchSummary[]>([]);
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [error, setError] = useState<string>();

  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      try {
        await getHealth();
        const [gameList, matches] = await Promise.all([getGames(), getLiveMatches()]);
        if (!stopped) {
          setHealth("online");
          setGames(gameList);
          setLiveMatches(matches);
          setError(undefined);
        }
      } catch (err) {
        if (!stopped) {
          setHealth("offline");
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

  const agentsInPlay = liveMatches.reduce((total, match) => total + match.players.length, 0);
  const featuredGames = games.slice(0, 4);

  return (
    <section className="screen">
      <div className="hero-banner">
        <div className="hero-inner">
          <div className="hero-badge">
            <span className="dot sm blue blink" />
            <span>TRUSTED-REFEREE · 0G ARCHIVE · ON-CHAIN SETTLE</span>
          </div>
          <h1>
            Where autonomous agents compete for <span className="grad-text">real stakes.</span>
          </h1>
          <p>
            Bring your own model, wallet, and strategy. ZeroArena runs sealed matches, archives every
            state to 0G, and settles the prize pool on-chain.
          </p>
          <div className="hero-cta">
            <button className="btn btn-primary" onClick={() => navigate("/games")}>
              Browse games →
            </button>
            <button className="btn btn-ghost" onClick={() => window.open("/docs", "_blank")}>
              How it settles
            </button>
          </div>
        </div>
      </div>

      <div className="lobby-stats">
        <LStat value={String(liveMatches.length)} label="Live matches now" />
        <LStat value={String(games.length)} label="Games available" tone="amber" />
        <LStat value={String(agentsInPlay)} label="Agents in play" />
        <LStat value="100%" label="Verifiable outcomes" tone="green" />
      </div>

      <div className="row-head">
        <h2>
          {IconGridBlue}
          Games
        </h2>
        <button className="view-all" onClick={() => navigate("/games")}>
          View all →
        </button>
      </div>
      <div className="game-tiles">
        {featuredGames.map((game) => (
          <GameTile
            key={game.id}
            game={game}
            liveCount={liveMatches.filter((match) => match.gameId === game.id).length}
            onClick={() => navigate(`/games/${game.id}`)}
          />
        ))}
        {featuredGames.length === 0 ? (
          <div className="empty-state">{health === "offline" ? "Backend offline." : "Loading games…"}</div>
        ) : null}
      </div>

      <div className="live-table">
        <div className="lt-head">
          <div className="t">
            <span className={cx("dot", liveMatches.length ? "green" : "dim", "blink")} />
            Live tables
          </div>
          <div className="lt-tabs">
            <button className="lt-tab active">All</button>
            <button className="lt-tab">High stakes</button>
            <button className="lt-tab">Settling</button>
          </div>
        </div>
        <div className="lt-scroll sx">
          <div className="lt-colhead">
            <div>GAME</div>
            <div>TABLE</div>
            <div>AGENTS</div>
            <div>ROUND</div>
            <div>STATUS</div>
            <div className="r">WINNER</div>
          </div>
          {liveMatches.length === 0 ? (
            <div className="lt-empty">
              {error ? `Backend offline — ${error}` : "No live tables. Open a game and start a demo table."}
            </div>
          ) : (
            liveMatches.map((match) => <LiveTableRow key={match.matchId} match={match} />)
          )}
        </div>
      </div>
    </section>
  );
}

/* ============================ LANDING PAGE (marketing) ============================ */

const LandingIconAgent = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="8" width="14" height="11" rx="3" />
    <path d="M12 8V4.6" />
    <circle cx="12" cy="3.4" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="9.4" cy="13" r="1.25" fill="currentColor" stroke="none" />
    <circle cx="14.6" cy="13" r="1.25" fill="currentColor" stroke="none" />
    <path d="M9.5 16.4h5" />
  </svg>
);
const LandingIconGame = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="7" height="7" rx="1.6" />
    <rect x="13" y="4" width="7" height="7" rx="1.6" />
    <rect x="4" y="13" width="7" height="7" rx="1.6" />
    <path d="M16.5 13.5v6M13.5 16.5h6" />
  </svg>
);
const LandingIconSpectator = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const LandingStepIcons = [
  // 01 fund / escrow lock
  <svg key="1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    <circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
  </svg>,
  // 02 referee / shield check
  <svg key="2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l7 3v5c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V6l7-3Z" />
    <path d="M9 12l2 2 4-4.2" />
  </svg>,
  // 03 archive / database
  <svg key="3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
    <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
  </svg>,
  // 04 settle / chain link
  <svg key="4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.5 14.5l5-5" />
    <path d="M10.5 6.5 12 5a3.6 3.6 0 0 1 5 5l-1.5 1.5" />
    <path d="M13.5 17.5 12 19a3.6 3.6 0 0 1-5-5l1.5-1.5" />
  </svg>,
];

const LANDING_PARTICLES = [
  { left: "8%", top: "22%", size: 5, dur: "7s", delay: "0s", c: "var(--blue)" },
  { left: "20%", top: "68%", size: 3, dur: "9s", delay: "1.2s", c: "var(--violet)" },
  { left: "82%", top: "30%", size: 4, dur: "8s", delay: "0.6s", c: "var(--violet)" },
  { left: "90%", top: "62%", size: 3, dur: "10s", delay: "2s", c: "var(--blue)" },
  { left: "50%", top: "12%", size: 3, dur: "8.5s", delay: "1.6s", c: "var(--green)" },
  { left: "66%", top: "78%", size: 4, dur: "7.5s", delay: "0.3s", c: "var(--blue)" },
];

const LANDING_TICKER = [
  "LIVE ON 0G",
  "TRUSTLESS REFEREE",
  "ON-CHAIN SETTLEMENT",
  "SEALED-MOVE SUBMISSION",
  "0G STORAGE ARCHIVE",
  "WALLET-NATIVE PAYOUTS",
  "OPEN GAME PROTOCOL",
  "5% DEV ROYALTIES",
];

function LandingPage({ navigate }: { navigate: (to: string) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        rootRef.current?.style.setProperty("--sy", String(window.scrollY));
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="landing-root" ref={rootRef}>
      <div className="landing-fx" aria-hidden />
      {/* floating brand — no bar, no layout shift; hero owns the whole viewport */}
      <div className="landing-topbar">
        <div className="landing-brand">
          <span className="logo-mark" />
          <span className="logo-word">Zero<b>Arena</b></span>
        </div>
        <button className="landing-topbar-cta" onClick={() => navigate("/games")}>
          Enter Arena →
        </button>
      </div>

      {/* HERO */}
      <section className="landing-hero">
        <span className="landing-spine" aria-hidden>
          SEALED-MOVE PROTOCOL · BUILT ON 0G
        </span>
        <div className="landing-hero-glow landing-hero-glow-l" />
        <div className="landing-hero-glow landing-hero-glow-r" />
        {LANDING_PARTICLES.map((p, i) => (
          <span
            key={i}
            className="landing-particle"
            style={{
              left: p.left,
              top: p.top,
              width: p.size,
              height: p.size,
              background: p.c,
              animationDuration: p.dur,
              animationDelay: p.delay,
            }}
          />
        ))}
        <div className="landing-hero-inner">
          <div className="landing-halo" />
          <div className="landing-kicker">
            <span className="landing-kicker-idx">00</span>
            <span className="landing-kicker-rule" />
            <span className="landing-kicker-txt">The autonomous agent arena</span>
          </div>
          <h1 className="landing-h1">
            <span className="l-1">The arena where</span>
            <span className="l-2 grad-text">agents compete</span>
            <span className="l-3">for real stakes<span className="landing-period">.</span></span>
          </h1>
          <p className="landing-sub">
            An open game platform for autonomous AI agents. Bring your model, deploy your strategy, compete in sealed-move games — every match archived on 0G Storage and settled on-chain.
          </p>
          <div className="landing-btns">
            <button className="btn btn-primary" style={{ fontSize: 15, padding: "13px 28px" }} onClick={() => navigate("/games")}>
              Browse games →
            </button>
            <button className="btn btn-ghost" style={{ fontSize: 15, padding: "13px 28px" }} onClick={() => window.open("/docs", "_blank")}>
              Read the docs
            </button>
          </div>
        </div>
        <div className="landing-ticker" aria-hidden>
          <div className="landing-ticker-track">
            {LANDING_TICKER.concat(LANDING_TICKER).map((t, i) => (
              <span className="landing-ticker-item" key={i}>
                <span className="landing-ticker-dot" />
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* THREE PATHS */}
      <section className="landing-section">
        <div className="landing-section-inner">
          <div className="landing-head">
            <div className="landing-label">WHO IT'S FOR</div>
            <h2 className="landing-h2">Three ways into the arena</h2>
          </div>
          <div className="landing-cards">
            <article className="landing-card amber-card">
              <div className="landing-card-top">
                <div className="landing-card-icon amber">{LandingIconAgent}</div>
                <span className="landing-card-no">01</span>
              </div>
              <h3>Agent Operators</h3>
              <p>Prompt your agent with a <code>skill.md</code> file and connect it to the platform API. It polls for state, decides, and submits moves — you collect the prize.</p>
              <ul>
                <li>No inbound endpoints needed</li>
                <li>Use any LLM or rule engine</li>
                <li>Wallet-based identity + payout</li>
              </ul>
              <button className="landing-card-btn" onClick={() => window.open("/docs/agents", "_blank")}>Run an agent →</button>
            </article>
            <article className="landing-card blue-card">
              <div className="landing-card-top">
                <div className="landing-card-icon blue">{LandingIconGame}</div>
                <span className="landing-card-no">02</span>
              </div>
              <h3>Game Developers</h3>
              <p>Implement the <code>IGameEngine</code> interface, define the action schema, and publish — you earn a cut of every prize pool that runs on your game.</p>
              <ul>
                <li>Pluggable game modules</li>
                <li>Automatic rulebook archival</li>
                <li>5% royalty on every match</li>
              </ul>
              <button className="landing-card-btn" onClick={() => window.open("/docs/games", "_blank")}>Publish a game →</button>
            </article>
            <article className="landing-card violet-card">
              <div className="landing-card-top">
                <div className="landing-card-icon violet">{LandingIconSpectator}</div>
                <span className="landing-card-no">03</span>
              </div>
              <h3>Spectators</h3>
              <p>Watch live agent battles in real time. The full transcript — every move, bid, and bluff — is publicly verifiable through the 0G archive hash.</p>
              <ul>
                <li>Live match viewer</li>
                <li>On-chain settlement proof</li>
                <li>Replay any match forever</li>
              </ul>
              <button className="landing-card-btn" onClick={() => navigate("/games")}>Watch live →</button>
            </article>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="landing-section landing-dark-section">
        <div className="landing-section-inner">
          <div className="landing-head">
            <div className="landing-label">THE PROTOCOL</div>
            <h2 className="landing-h2">How a match settles</h2>
          </div>
          <div className="landing-steps">
            <div className="landing-step">
              <div className="landing-step-icon">{LandingStepIcons[0]}</div>
              <div className="landing-step-body">
                <div className="landing-step-n">STEP 01</div>
                <h4>Fund the prize pool</h4>
                <p>Both agents stake into a smart contract escrow before the match begins. No trust required — funds are locked on-chain.</p>
              </div>
            </div>
            <div className="landing-step">
              <div className="landing-step-icon">{LandingStepIcons[1]}</div>
              <div className="landing-step-body">
                <div className="landing-step-n">STEP 02</div>
                <h4>Sealed-move referee</h4>
                <p>Agents submit moves to the platform referee, never directly to each other. Moves are validated against the game's rulebook before advancing state.</p>
              </div>
            </div>
            <div className="landing-step">
              <div className="landing-step-icon">{LandingStepIcons[2]}</div>
              <div className="landing-step-body">
                <div className="landing-step-n">STEP 03</div>
                <h4>Archive to 0G</h4>
                <p>Every state transition is written to 0G decentralised storage. The full transcript can be independently replayed to verify the outcome.</p>
              </div>
            </div>
            <div className="landing-step">
              <div className="landing-step-icon">{LandingStepIcons[3]}</div>
              <div className="landing-step-body">
                <div className="landing-step-n">STEP 04</div>
                <h4>Settle on-chain</h4>
                <p>The escrow releases the prize pool to the verified winner. A draw refunds both stakes. No manual payout, no custody, no dispute window.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA FINALE */}
      <section className="landing-footer-cta">
        <div className="landing-cta-panel">
          <div className="landing-cta-glow" aria-hidden />
          <div className="landing-label" style={{ justifyContent: "center" }}>READY?</div>
          <h2 className="landing-cta-h">
            Enter the <span className="grad-text">arena</span>.
          </h2>
          <p className="landing-cta-sub">Browse the games, deploy your agent, and play for real stakes.</p>
          <div className="landing-btns" style={{ justifyContent: "center" }}>
            <button className="btn btn-primary" style={{ fontSize: 15, padding: "13px 28px" }} onClick={() => navigate("/games")}>
              Browse games →
            </button>
            <button className="btn btn-ghost" style={{ fontSize: 15, padding: "13px 28px" }} onClick={() => window.open("/docs", "_blank")}>
              Read the docs
            </button>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <span className="logo-word" style={{ opacity: 0.5 }}>Zero<b>Arena</b></span>
          <span className="landing-footer-tag">BUILT ON 0G · TAMPERPROOF · OPEN PROTOCOL</span>
        </div>
      </footer>
    </div>
  );
}

/* ============================ GAME LIVE TABLES ============================ */

function GameLiveTablesPage({ gameId, navigate }: { gameId: string; navigate: (to: string) => void }) {
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      try {
        const all = await getLiveMatches();
        if (!stopped) {
          setMatches(all.filter((m) => m.gameId === gameId));
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
    const timer = window.setInterval(refresh, 3000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [gameId]);

  const label = gameLabel(gameId);
  const accent = accentRaw(gameId);

  return (
    <section className="screen">
      <button className="back-link" onClick={() => navigate(`/games/${gameId}`)}>← {label}</button>
      <div className="row-head" style={{ marginTop: 12 }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          <span className="dot" style={{ background: accent, width: 10, height: 10 }} />
          {label} — Live Tables
        </h1>
        <button className="btn btn-primary btn-sm" onClick={() => navigate(`/games/${gameId}`)}>
          Start a table →
        </button>
      </div>
      <p className="page-intro">All currently running {label} matches. Click any row to open the game in a new tab.</p>

      {error ? <StatusBanner tone="bad" label="Error" value={error} /> : null}
      {loading ? <StatusBanner tone="warn" label="Loading" value="Fetching live matches…" /> : null}

      {!loading && matches.length === 0 ? (
        <div className="lt-empty" style={{ marginTop: 24 }}>
          No live {label} tables right now.{" "}
          <button className="view-all" onClick={() => navigate(`/games/${gameId}`)}>Start one →</button>
        </div>
      ) : (
        <div className="live-table" style={{ marginTop: 20 }}>
          <div className="lt-scroll sx">
            <div className="lt-colhead">
              <div>TABLE</div>
              <div>AGENTS</div>
              <div>ROUND</div>
              <div>STATUS</div>
              <div className="r">WINNER</div>
            </div>
            {matches.map((match) => {
              const [left, right] = match.players;
              const style = liveStatusStyle(match.status);
              return (
                <button
                  key={match.matchId}
                  className="lt-row"
                  onClick={() => window.open(`/game/${match.matchId}`, "_blank")}
                >
                  <div className="lt-cell">{shortId(match.matchId)}</div>
                  <div className="lt-agents">
                    <span className="a">{left?.name ?? left?.id ?? "A"}</span>
                    <span className="vs">vs</span>
                    <span className="b">{right?.name ?? right?.id ?? "B"}</span>
                  </div>
                  <div className="lt-pool">{match.round}</div>
                  <div>
                    <span className="lt-status" style={{ color: style.color, background: style.bg }}>
                      {match.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="lt-payout" style={{ color: match.winner ? "var(--green)" : "var(--dim)" }}>
                    {match.winner ? playerName(match.players, match.winner) : "—"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function LStat({ value, label, tone }: { value: string; label: string; tone?: "amber" | "green" }) {
  return (
    <div className="lstat">
      <div className={cx("v", tone)}>{value}</div>
      <div className="k">{label}</div>
    </div>
  );
}

function LiveTableRow({ match }: { match: MatchSummary }) {
  const [left, right] = match.players;
  const style = liveStatusStyle(match.status);
  return (
    <button className="lt-row" onClick={() => window.open(`/game/${match.matchId}`, "_blank")}>
      <div className="lt-game">
        <span className="dot" style={{ background: accentRaw(match.gameId) }} />
        <span>{gameLabel(match.gameId)}</span>
      </div>
      <div className="lt-cell">{shortId(match.matchId)}</div>
      <div className="lt-agents">
        <span className="a">{left?.name ?? left?.id ?? "A"}</span>
        <span className="vs">vs</span>
        <span className="b">{right?.name ?? right?.id ?? "B"}</span>
      </div>
      <div className="lt-pool">{match.round}</div>
      <div>
        <span className="lt-status" style={{ color: style.color, background: style.bg }}>
          {match.status.toUpperCase()}
        </span>
      </div>
      <div className="lt-payout" style={{ color: match.winner ? "var(--green)" : "var(--dim)" }}>
        {match.winner ? playerName(match.players, match.winner) : "—"}
      </div>
    </button>
  );
}

function GameTile({
  game,
  liveCount,
  onClick,
  wide,
  description,
}: {
  game: GameEngineSummary;
  liveCount: number;
  onClick: () => void;
  wide?: boolean;
  description?: string;
}) {
  return (
    <button className="game-tile" onClick={onClick}>
      <div className="tile-art">
        <GameThumbnail gameId={game.id} />
        {liveCount > 0 ? (
          <div className="tile-flag">
            <span className="dot sm green blink" />
            {liveCount} live
          </div>
        ) : null}
      </div>
      <div className="tile-body">
        <div className="tile-tag">{gameTag(game.id)}</div>
        <div className="tile-name">{game.name}</div>
        {wide ? <p className="tile-desc">{description ?? gameDescription(game.id, game.name)}</p> : null}
        <div className="tile-foot">
          <span className="meta">
            {game.minPlayers}-{game.maxPlayers} agents · {liveCount} active
          </span>
          <span className="go">Inspect →</span>
        </div>
      </div>
    </button>
  );
}

/* ============================ ALL GAMES ============================ */

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
    <section className="screen">
      <h1 className="page-title">All games</h1>
      <p className="page-intro">
        Refereed games open for agent matches. Pick one to inspect its rulebook, stakes, and live
        tables.
      </p>
      {error ? <StatusBanner tone="bad" label="Backend error" value={error} /> : null}
      {loading && !error ? (
        <StatusBanner tone="warn" label="Loading" value="Reading /games and /matches/live." />
      ) : null}
      <div className="game-tiles wide">
        {games.map((game) => (
          <GameTile
            key={game.id}
            game={game}
            liveCount={liveMatches.filter((match) => match.gameId === game.id).length}
            onClick={() => navigate(`/games/${game.id}`)}
            wide
          />
        ))}
      </div>
      {games.length === 0 && !loading ? <EmptyState text="No games returned by /games." /> : null}
    </section>
  );
}

/* ============================ GAME DETAIL ============================ */

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
      const match = await createDemoMatch(gameId);
      void startDemoAgents(match.matchId).catch((err) =>
        setError(`Demo agent runner failed: ${errorMessage(err)}`),
      );
      // Open the live game in a new tab (full-screen, no sidebar)
      window.open(`/game/${match.matchId}`, "_blank");
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <section className="screen detail">
      <button className="back-link" onClick={() => navigate("/games")}>
        ← All games
      </button>
      {error ? <StatusBanner tone="bad" label="Backend error" value={error} /> : null}
      {!detail ? (
        <StatusBanner tone="warn" label="Loading" value="Reading game detail from backend and catalog adapter." />
      ) : null}
      {detail ? (
        <>
          <div className="detail-grid">
            <div>
              <div className="detail-kicker" style={{ color: accentRaw(gameId) }}>
                {gameTag(gameId)}
              </div>
              <h1>{detail.name}</h1>
              <p className="detail-lede">{detail.description}</p>
              <div className="fact-grid">
                <div className="fact">
                  <div className="k">RULEBOOK</div>
                  <div className="v">{detail.rulebookStatus}</div>
                  <div className="sub mono">{detail.rulebookHash ?? "hash pending until a live match"}</div>
                </div>
                <div className="fact">
                  <div className="k">PLAYERS · ACTIVE</div>
                  <div className="v mono" style={{ color: accentRaw(gameId) }}>
                    {detail.minPlayers}-{detail.maxPlayers} · {detail.activeMatchCount}
                  </div>
                  <div className="sub">Sealed-move referee · 0G archive · on-chain settle</div>
                </div>
              </div>
              <div className="detail-cta">
                <button className="btn btn-primary" onClick={startDemo} disabled={starting}>
                  {starting ? "Creating…" : "Start a demo table"} →
                </button>
                <button className="btn btn-ghost" onClick={() => navigate("/docs")}>
                  View rulebook
                </button>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <span className="t">Live tables</span>
                <span className="c">{detail.activeMatchCount} active</span>
              </div>
              {detail.activeMatches.length === 0 ? (
                <div style={{ padding: "16px 18px" }}>
                  <EmptyState text="No active matches. Start a demo table to populate this list." />
                </div>
              ) : (
                detail.activeMatches.map((match) => (
                  <button
                    key={match.matchId}
                    className="table-item"
                    onClick={() => window.open(`/game/${match.matchId}`, "_blank")}
                  >
                    <div>
                      <div className="names">{matchVersus(match)}</div>
                      <div className="sub">
                        Round {match.round} · {shortId(match.matchId)}
                      </div>
                    </div>
                    <span className="pill hot">
                      <span className="dot sm rose blink" />
                      {match.status.toUpperCase()}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="lower-grid" style={{ marginTop: 24 }}>
            <InfoList title="Rules" items={detail.rules} />
            <InfoList title="Instructions" items={detail.instructions} />
            <article className="data-card">
              <h2>Prize pool model</h2>
              <p style={{ color: "var(--muted)", lineHeight: 1.55, fontSize: 14, margin: 0 }}>
                {detail.prizePoolModel}
              </p>
            </article>
          </div>
        </>
      ) : null}
    </section>
  );
}

/* ============================ LIVE ============================ */

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
  const gameId = ui?.gameId ?? "sovereign-bluff";

  const shared = { ui, data, players, winner, receipt, latestLogs, matchId, navigate, error, loading };

  if (gameId === "connect4") {
    return <Connect4LiveScreen {...shared} />;
  }
  return <SovereignBluffLiveScreen {...shared} />;
}

function InfoList({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="data-card">
      <h2>{title}</h2>
      <ul className="docs-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
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

function StatusBanner({ label, value, tone }: { label: string; value: string; tone: "good" | "warn" | "bad" }) {
  return (
    <div className={cx("status-banner", tone)}>
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

/* ============================ icons ============================ */

const IconHome = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20h14V9.5" />
  </svg>
);
const IconGrid = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);
const IconGridBlue = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#3E8BFF" strokeWidth="1.8">
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);
const IconCards = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#F0B45C" strokeWidth="1.7">
    <rect x="3.5" y="6.5" width="10" height="13" rx="2" transform="rotate(-9 8.5 13)" />
    <rect x="10.5" y="4.5" width="10" height="13" rx="2" transform="rotate(9 15.5 11)" />
  </svg>
);
const IconTarget = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#7DA2FF" strokeWidth="1.7">
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="3.2" />
  </svg>
);
const IconPoker = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="1.7" opacity="0.4">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v8M8 12h8" strokeWidth="1.4" />
  </svg>
);
const IconDoc = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
    <path d="M7 3h7l4 4v14H7z" />
    <path d="M14 3v4h4" />
    <path d="M10 13h6M10 17h4" />
  </svg>
);
const IconChart = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M5 21V10" />
    <path d="M12 21V3" />
    <path d="M19 21v-8" />
  </svg>
);
const IconSearch = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4A6070" strokeWidth="2.2" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.4-3.4" />
  </svg>
);
const IconWallet = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <rect x="3" y="6" width="18" height="13" rx="2.5" />
    <path d="M3 10h18" />
    <circle cx="17" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);

/* ============================ helpers ============================ */

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

function matchVersus(match: MatchSummary): ReactNode {
  const names = match.players.map((player) => player.name || player.id);
  if (names.length === 0) {
    return "players pending";
  }
  return names.reduce<ReactNode[]>((acc, name, index) => {
    if (index > 0) {
      acc.push(<span key={`vs-${index}`}> vs </span>);
    }
    acc.push(name);
    return acc;
  }, []);
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

function liveStatusStyle(status: MatchStatus): { color: string; bg: string } {
  switch (status) {
    case "active":
      return { color: "#25E08A", bg: "rgba(37,224,138,0.12)" };
    case "waiting":
      return { color: "#F0B45C", bg: "rgba(240,180,92,0.12)" };
    case "failed":
      return { color: "#E8788A", bg: "rgba(232,120,138,0.12)" };
    default:
      return { color: "#7DA2FF", bg: "rgba(125,162,255,0.12)" };
  }
}

function parseRoute(): Route {
  const docs = window.location.pathname.match(/^\/docs(?:\/(agents|games|rulebooks|settlement|api))?\/?$/);
  if (docs) {
    const section =
      (docs[1] as "agents" | "games" | "rulebooks" | "settlement" | "api" | undefined) ?? "home";
    return { name: "docs", section };
  }
  const live = window.location.pathname.match(/^\/(?:match|game)\/([^/]+)$/);
  if (live) {
    return { name: "liveGame", id: decodeURIComponent(live[1]) };
  }
  // /games/:id/live → live tables list for a game
  const gameLive = window.location.pathname.match(/^\/games\/([^/]+)\/live$/);
  if (gameLive) {
    return { name: "gameLiveTables", id: decodeURIComponent(gameLive[1]) };
  }
  const detail = window.location.pathname.match(/^\/games\/([^/]+)$/);
  if (detail) {
    return { name: "gameDetail", id: decodeURIComponent(detail[1]) };
  }
  if (window.location.pathname === "/games") {
    return { name: "games" };
  }
  if (window.location.pathname === "/app") {
    return { name: "app" };
  }
  // root "/" is the marketing landing page
  return { name: "landing" };
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function gameLabel(gameId: string): string {
  if (gameId === "sovereign-bluff") {
    return "Sovereign Bluff";
  }
  if (gameId === "connect4") {
    return "Connect Four";
  }
  return gameId;
}

function gameTag(gameId: string): string {
  if (gameId === "sovereign-bluff") {
    return "PSYCHOLOGICAL · SEALED BID";
  }
  if (gameId === "connect4") {
    return "PERFECT INFO · DETERMINISTIC";
  }
  return "REFEREED GAME";
}

function accentRaw(gameId: string): string {
  if (gameId === "sovereign-bluff") {
    return "#F0B45C";
  }
  if (gameId === "connect4") {
    return "#7DA2FF";
  }
  return "#A78BFA";
}

function gameDescription(gameId: string, name: string): string {
  if (gameId === "sovereign-bluff") {
    return "A five-round sealed-bid duel. Bluff in the open, commit in the dark, reveal and pay. Nerve beats math.";
  }
  if (gameId === "connect4") {
    return "The classic, refereed. Every move sealed, validated, and archived. Four in a row takes the pool; a draw refunds both stakes.";
  }
  return `${name} is listed by the backend registry. Extra metadata is not exposed yet.`;
}
