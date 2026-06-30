import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ExternalLink,
  Eye,
  EyeOff,
  Play,
  RefreshCw,
  Save,
  Square,
  Terminal,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  getAgentLogs,
  getAgents,
  getBackendGames,
  getBackendHealth,
  getConfigs,
  saveConfig,
  startAgent,
  stopAgent,
  type AgentConfig,
  type AgentProcessSummary,
  type GameSummary,
  type MaskedAgentConfig,
  type StrategyId,
  type ValidationIssue,
} from "./api";

const defaultConfig: AgentConfig = {
  label: "Alpha",
  gameId: "connect4",
  strategy: "connect4-basic",
  walletAddress: "0x00000000000000000000000000000000000000a1",
  privateKey: "",
  zeroArenaApiUrl: "http://127.0.0.1:3001",
  zeroGRpcUrl: "https://evmrpc-testnet.0g.ai",
  zeroGProviderAddress: "",
  zeroGModel: "",
  requestSpacingMs: 7000,
  temperature: 0.35,
  topP: 0.9,
  prompt: defaultPrompt("connect4-0g"),
  allowLocalDevAuth: true,
};

const strategies: Array<{ id: StrategyId; gameId: AgentConfig["gameId"]; title: string; body: string }> = [
  { id: "connect4-basic", gameId: "connect4", title: "Connect4 Basic", body: "Deterministic local strategy using the SDK runner." },
  { id: "connect4-0g", gameId: "connect4", title: "Connect4 0G", body: "Local SDK agent using 0G inference, with deterministic fallback." },
  { id: "sovereign-bluff-basic", gameId: "sovereign-bluff", title: "Sovereign Bluff Basic", body: "Deterministic local fallback strategy for dry runs." },
  { id: "sovereign-bluff-0g", gameId: "sovereign-bluff", title: "Sovereign Bluff 0G", body: "Local SDK agent using 0G inference for broadcast and bids." },
  { id: "signal-duel-basic", gameId: "signal-duel", title: "Signal Duel Basic", body: "Deterministic local strategy for hidden rock/paper/scissors duels." },
  { id: "signal-duel-0g", gameId: "signal-duel", title: "Signal Duel 0G", body: "Local SDK agent using 0G inference for banter and hidden commits." },
];

export default function App() {
  const [config, setConfig] = useState<AgentConfig>(defaultConfig);
  const [configs, setConfigs] = useState<MaskedAgentConfig[]>([]);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [agents, setAgents] = useState<AgentProcessSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>();
  const [logs, setLogs] = useState<string[]>([]);
  const [backendState, setBackendState] = useState<"checking" | "connected" | "offline" | "error">("checking");
  const [backendError, setBackendError] = useState<string>();
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [saveState, setSaveState] = useState<string>();
  const [view, setView] = useState<"configure" | "runtime">("configure");
  const [showKey, setShowKey] = useState(false);

  const requires0G = config.strategy.endsWith("-0g");
  const filteredStrategies = strategies.filter((item) => item.gameId === config.gameId);
  const currentGame = games.find((game) => game.id === config.gameId);
  const validation = useMemo(() => localValidation(config), [config]);
  const canStart = validation.length === 0 && Boolean(config.id);
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];
  const arenaUrl = config.zeroArenaApiUrl.replace(/:\d+$/, ":5173");
  const runningCount = agents.filter((agent) => agent.status !== "finished" && agent.status !== "error").length;

  const refreshBackend = async () => {
    setBackendState("checking");
    try {
      const [health, result] = await Promise.all([
        getBackendHealth(config.zeroArenaApiUrl),
        getBackendGames(config.zeroArenaApiUrl),
      ]);
      setBackendState(health.ok ? "connected" : "offline");
      setBackendError(health.error);
      setGames(result.games);
    } catch (error) {
      setBackendState("error");
      setBackendError(errorMessage(error));
      setGames([]);
    }
  };

  const refreshLocal = async () => {
    const [nextConfigs, nextAgents] = await Promise.all([getConfigs(), getAgents()]);
    setConfigs(nextConfigs);
    setAgents(nextAgents);
  };

  useEffect(() => {
    void refreshLocal();
    void refreshBackend();
    const timer = window.setInterval(() => {
      void getAgents().then(setAgents).catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshBackend(), 450);
    return () => window.clearTimeout(timer);
  }, [config.zeroArenaApiUrl]);

  useEffect(() => {
    if (!selectedAgent?.id) {
      setLogs([]);
      return;
    }
    void getAgentLogs(selectedAgent.id).then((result) => setLogs(result.logs)).catch(() => setLogs([]));
    const events = new EventSource(`/api/agents/${encodeURIComponent(selectedAgent.id)}/events`);
    events.addEventListener("log", (event) => {
      const parsed = JSON.parse((event as MessageEvent).data);
      setLogs((current) => [...current.slice(-499), parsed.line]);
    });
    events.addEventListener("status", () => void getAgents().then(setAgents));
    events.onerror = () => events.close();
    return () => events.close();
  }, [selectedAgent?.id]);

  const update = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) => {
    const next = { ...config, [key]: value };
    if (key === "gameId") {
      const strategy = strategies.find((item) => item.gameId === value)?.id ?? "connect4-basic";
      next.strategy = strategy;
      next.prompt = defaultPrompt(strategy);
    }
    if (key === "strategy") {
      next.prompt = config.prompt || defaultPrompt(String(value) as StrategyId);
    }
    setConfig(next);
  };

  const persist = async () => {
    setSaveState("Saving...");
    setIssues([]);
    try {
      const saved = await saveConfig(config);
      setConfig({ ...config, id: saved.id, privateKey: saved.privateKey ?? "" });
      await refreshLocal();
      setSaveState("Saved. Secrets are masked in the console.");
    } catch (error) {
      setIssues((error as Error & { issues?: ValidationIssue[] }).issues ?? [{ field: "config", message: errorMessage(error) }]);
      setSaveState(undefined);
    }
  };

  const start = async () => {
    if (!config.id) {
      await persist();
    }
    const id = config.id;
    if (!id) {
      return;
    }
    const result = await startAgent(id);
    setSelectedAgentId(result.localAgentId);
    setView("runtime");
    await refreshLocal();
  };

  const allIssues = [...validation, ...issues];

  return (
    <div className="operator">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <div className="brand-text">
            <div className="brand-row">
              <strong>Zero<b>Arena</b></strong>
              <span className="brand-pill">OPERATOR</span>
            </div>
            <span className="brand-sub">Local SDK agent control · keys stay on this machine</span>
          </div>
        </div>

        <nav className="view-tabs">
          <button className={view === "configure" ? "active" : ""} onClick={() => setView("configure")}>Configure</button>
          <button className={view === "runtime" ? "active" : ""} onClick={() => setView("runtime")}>
            Runtime
            {runningCount > 0 ? <span className="view-tab-badge">{runningCount}</span> : null}
          </button>
        </nav>

        <div className={`conn ${backendState}`}>
          {backendState === "connected" ? <Wifi size={16} /> : <WifiOff size={16} />}
          <span>{backendState === "connected" ? "connected" : backendState}</span>
          <code>{config.zeroArenaApiUrl}</code>
        </div>
      </header>

      {view === "configure" ? (
        <main className="workspace">
          <aside className="panel pick-panel">
            <SectionTitle
              title="Available Games"
              action={<IconButton label="Refresh backend" onClick={refreshBackend}><RefreshCw size={15} /></IconButton>}
            />
            <div className="game-grid">
              {games.map((game) => (
                <button key={game.id} className={`game-card ${config.gameId === game.id ? "active" : ""}`} onClick={() => update("gameId", game.id as AgentConfig["gameId"])}>
                  <strong>{game.name}</strong>
                  <code>{game.id}</code>
                  <span>{game.minPlayers}-{game.maxPlayers} agents · {game.active === false ? "inactive" : "active"}</span>
                  <small>{game.rulesHash ? `rulebook ${short(game.rulesHash)}` : "rulebook not exposed"}</small>
                </button>
              ))}
              {games.length === 0 ? <Empty text={backendState === "connected" ? "No games returned by /games." : "Backend offline. Saved configs still work."} /> : null}
            </div>

            {currentGame ? (
              <>
                <SectionTitle title={`Strategy · ${currentGame.name}`} />
                <div className="strategy-list">
                  {filteredStrategies.map((item) => (
                    <button key={item.id} className={config.strategy === item.id ? "active" : ""} onClick={() => update("strategy", item.id)}>
                      <strong>{item.title}</strong>
                      <span>{item.body}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </aside>

          <section className="panel config-panel">
            <SectionTitle title="Backend" />
            <label>
              ZeroArena API URL
              <input value={config.zeroArenaApiUrl} onChange={(e) => update("zeroArenaApiUrl", e.target.value)} />
            </label>
            {backendError ? <div className="inline-error">Reconnect / check backend URL: {backendError}</div> : null}

            <SectionTitle title="Agent Config" />
            <div className="form-grid">
              <label>
                Agent label
                <input value={config.label} onChange={(e) => update("label", e.target.value)} />
              </label>
              <label>
                Wallet address
                <input value={config.walletAddress} onChange={(e) => update("walletAddress", e.target.value)} />
              </label>
            </div>
            <label>
              Private key
              <div className="secret-row">
                <input
                  type={showKey ? "text" : "password"}
                  value={config.privateKey ?? ""}
                  placeholder={config.id ? "masked after save" : "0x..."}
                  onChange={(e) => update("privateKey", e.target.value)}
                />
                <IconButton label={showKey ? "Hide key" : "Reveal key"} onClick={() => setShowKey(!showKey)}>
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </IconButton>
              </div>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={config.allowLocalDevAuth} onChange={(e) => update("allowLocalDevAuth", e.target.checked)} />
              Allow local-dev auth for mock/local backends
            </label>
            <p className="warning">This local operator stores credentials on this machine. Use test wallets. ZeroArena sees signed actions, not your private key.</p>

            {requires0G ? (
              <>
                <SectionTitle title="0G Serving" />
                <div className="form-grid">
                  <label>
                    0G RPC URL
                    <input value={config.zeroGRpcUrl ?? ""} onChange={(e) => update("zeroGRpcUrl", e.target.value)} />
                  </label>
                  <label>
                    Provider address
                    <input value={config.zeroGProviderAddress ?? ""} onChange={(e) => update("zeroGProviderAddress", e.target.value)} />
                  </label>
                  <label>
                    Model
                    <input value={config.zeroGModel ?? ""} onChange={(e) => update("zeroGModel", e.target.value)} />
                  </label>
                  <label>
                    Request spacing ms
                    <input type="number" value={config.requestSpacingMs} onChange={(e) => update("requestSpacingMs", Number(e.target.value))} />
                  </label>
                  <label>
                    Temperature
                    <input type="number" step="0.05" value={config.temperature ?? ""} onChange={(e) => update("temperature", Number(e.target.value))} />
                  </label>
                  <label>
                    Top P
                    <input type="number" step="0.05" value={config.topP ?? ""} onChange={(e) => update("topP", Number(e.target.value))} />
                  </label>
                </div>
              </>
            ) : null}

            <SectionTitle title="Prompt / Skill Text" />
            <textarea value={config.prompt ?? ""} onChange={(e) => update("prompt", e.target.value)} />

            {configs.length > 0 ? (
              <>
                <SectionTitle title="Saved Configs" />
                <div className="saved-list">
                  {configs.map((saved) => (
                    <button key={saved.id} onClick={() => loadSaved(saved)}>
                      <strong>{saved.label}</strong>
                      <span>{saved.gameId} · {saved.strategy}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            <div className="actions">
              <button className="primary" onClick={persist}><Save size={16} />Save Config</button>
              <button className="start" onClick={start} disabled={!canStart}><Play size={16} />Start Agent</button>
              {saveState ? <span>{saveState}</span> : null}
            </div>
          </section>
        </main>
      ) : (
        <main className="runtime">
          <div className="agent-table">
            <div className="table-head">
              <span><Activity size={15} />Running agents</span>
              <a className="head-link" href={arenaUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} />Open Arena</a>
            </div>
            <div className="rows">
              {agents.map((agent) => (
                <button key={agent.id} className={selectedAgent?.id === agent.id ? "active" : ""} onClick={() => setSelectedAgentId(agent.id)}>
                  <StatusChip status={agent.status} />
                  <strong>{agent.label}</strong>
                  <span>{agent.gameId}</span>
                  <code>{short(agent.walletAddress)}</code>
                  <span>{agent.matchId ? short(agent.matchId) : "match pending"}</span>
                  <span>{runtime(agent.startedAt, agent.stoppedAt)}</span>
                  <IconButton label="Stop" onClick={(event) => { event.stopPropagation(); void stopAgent(agent.id).then(refreshLocal); }}><Square size={14} /></IconButton>
                </button>
              ))}
              {agents.length === 0 ? <Empty text="No running agents. Configure one, then Start Agent." /> : null}
            </div>
          </div>
          <div className="logs">
            <div className="table-head">
              <span><Terminal size={15} />Logs{selectedAgent ? ` · ${selectedAgent.label}` : ""}</span>
              {selectedAgent?.matchId ? <a className="head-link" href={`${arenaUrl}/match/${selectedAgent.matchId}`} target="_blank" rel="noreferrer"><ExternalLink size={13} />Open Match</a> : null}
            </div>
            <pre>{logs.length ? logs.join("\n") : "Select a running agent to inspect local process logs."}</pre>
          </div>
        </main>
      )}

      {allIssues.length > 0 ? (
        <div className="issue-toast" role="status">
          <div className="issue-toast-head"><AlertTriangle size={14} />{allIssues.length} thing{allIssues.length === 1 ? "" : "s"} to fix before launch</div>
          <ul>
            {allIssues.map((issue) => <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );

  function loadSaved(saved: MaskedAgentConfig) {
    setConfig({
      id: saved.id,
      label: saved.label,
      gameId: saved.gameId,
      strategy: saved.strategy,
      walletAddress: saved.walletAddress,
      privateKey: saved.privateKey ?? "",
      zeroArenaApiUrl: saved.zeroArenaApiUrl,
      zeroGRpcUrl: saved.zeroGRpcUrl,
      zeroGProviderAddress: saved.zeroGProviderAddress,
      zeroGModel: saved.zeroGModel,
      requestSpacingMs: saved.requestSpacingMs,
      temperature: saved.temperature,
      topP: saved.topP,
      prompt: saved.prompt,
      allowLocalDevAuth: saved.allowLocalDevAuth,
    });
  }
}

function SectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return <div className="section-title"><h2>{title}</h2>{action}</div>;
}

function IconButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: React.MouseEventHandler<HTMLButtonElement> }) {
  return <button className="icon-btn" title={label} aria-label={label} onClick={onClick}>{children}</button>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function StatusChip({ status }: { status: string }) {
  return <span className={`status ${status}`}>{status}</span>;
}

function localValidation(config: AgentConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const req = (field: keyof AgentConfig, message: string) => {
    if (!String(config[field] ?? "").trim()) issues.push({ field, message });
  };
  req("label", "agent label is required");
  req("walletAddress", "wallet address is required");
  req("zeroArenaApiUrl", "backend API URL is required");
  if (!config.allowLocalDevAuth && !config.privateKey?.includes("*")) req("privateKey", "private key is required for wallet auth");
  if (config.strategy.endsWith("-0g")) {
    req("privateKey", "private key is required for 0G inference");
    req("zeroGRpcUrl", "0G RPC URL is required");
    req("zeroGProviderAddress", "0G provider address is required");
    req("zeroGModel", "0G model is required");
    req("prompt", "prompt is required");
    if (config.requestSpacingMs < 7000) issues.push({ field: "requestSpacingMs", message: "default to at least 7000ms to avoid 0G rate limits" });
  }
  return issues;
}

function defaultPrompt(strategy: StrategyId): string {
  if (strategy === "sovereign-bluff-0g") {
    return "Play Sovereign Bluff as a cautious but opportunistic negotiator. Broadcast concise pressure, bid legally, preserve balance, and return one JSON action only.";
  }
  if (strategy === "signal-duel-0g") {
    return "Play Signal Duel. Each player has one rock, paper, scissors, plus one unknown duplicate. Use dialogue to bluff in one concise sentence. Commit only a legal move from validMoves and return one JSON action only.";
  }
  return "Play Connect4 to win. Return exactly one JSON object with a legal column. Prefer immediate wins, then blocks, then strong central positioning.";
}

function short(value?: string): string {
  if (!value) return "";
  return value.length <= 14 ? value : `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function runtime(startedAt: string, stoppedAt?: string): string {
  const end = stoppedAt ? Date.parse(stoppedAt) : Date.now();
  const seconds = Math.max(0, Math.floor((end - Date.parse(startedAt)) / 1000));
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
