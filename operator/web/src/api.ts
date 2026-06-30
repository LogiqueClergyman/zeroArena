export type StrategyId = "connect4-basic" | "connect4-0g" | "sovereign-bluff-basic" | "sovereign-bluff-0g";
export type AgentStatus = "idle" | "starting" | "joining" | "waiting" | "matched" | "playing" | "finished" | "error" | "stopped";

export interface GameSummary {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  rulesHash?: string;
  rulesUrl?: string;
  rulesVersion?: string;
  active?: boolean;
  actionSchema?: unknown;
}

export interface AgentConfig {
  id?: string;
  label: string;
  gameId: "connect4" | "sovereign-bluff";
  strategy: StrategyId;
  walletAddress: string;
  privateKey?: string;
  zeroArenaApiUrl: string;
  zeroGRpcUrl?: string;
  zeroGProviderAddress?: string;
  zeroGModel?: string;
  requestSpacingMs: number;
  temperature?: number;
  topP?: number;
  prompt?: string;
  allowLocalDevAuth: boolean;
}

export interface MaskedAgentConfig extends AgentConfig {
  id: string;
  hasPrivateKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentProcessSummary {
  id: string;
  configId: string;
  label: string;
  gameId: string;
  strategy: StrategyId;
  walletAddress: string;
  backendUrl: string;
  status: AgentStatus;
  matchId?: string;
  startedAt: string;
  stoppedAt?: string;
  exitCode?: number | null;
  error?: string;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export async function getHealth() {
  return request<{ ok: boolean; version: string }>("/api/health");
}

export async function getBackendHealth(baseUrl: string) {
  return request<{ ok: boolean; baseUrl: string; error?: string }>(`/api/backend/health?baseUrl=${encodeURIComponent(baseUrl)}`);
}

export async function getBackendGames(baseUrl: string) {
  return request<{ games: GameSummary[]; baseUrl: string }>(`/api/backend/games?baseUrl=${encodeURIComponent(baseUrl)}`);
}

export async function getConfigs() {
  return request<MaskedAgentConfig[]>("/api/configs");
}

export async function saveConfig(config: AgentConfig) {
  return request<MaskedAgentConfig>("/api/configs", {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export async function startAgent(configId: string) {
  return request<{ localAgentId: string; agent: AgentProcessSummary }>("/api/agents/start", {
    method: "POST",
    body: JSON.stringify({ configId }),
  });
}

export async function stopAgent(id: string) {
  return request<{ ok: boolean }>(`/api/agents/${encodeURIComponent(id)}/stop`, { method: "POST" });
}

export async function getAgents() {
  return request<AgentProcessSummary[]>("/api/agents");
}

export async function getAgentLogs(id: string) {
  return request<{ logs: string[] }>(`/api/agents/${encodeURIComponent(id)}/logs`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...(init.headers ?? {}) } : init?.headers,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const error = new Error(data?.error ?? response.statusText) as Error & { issues?: ValidationIssue[] };
    error.issues = data?.issues;
    throw error;
  }
  return data as T;
}
