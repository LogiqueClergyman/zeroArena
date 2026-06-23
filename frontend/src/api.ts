const baseUrl = import.meta.env.VITE_BACKEND_URL ? import.meta.env.VITE_BACKEND_URL : "/api";

export type MatchStatus = "waiting" | "active" | "finished" | "archived" | "paid" | "failed";
export type InferenceMode = "0g-serving" | "mock fallback" | "mock";

export interface Player {
  id: string;
  name: string;
  walletAddress: string;
  inferenceMode?: InferenceMode;
  agentKind?: "mock" | "0g-serving";
  balance?: number | string;
}

export interface AgentLog {
  playerId: string;
  walletAddress: string;
  inferenceMode: "0g-serving" | "mock fallback";
  provider: string;
  model: string;
  latencyMs: number;
  validationResult: { ok: boolean; error?: string };
  fallbackReason?: string;
}

export interface FundingTxReceipt {
  playerId: string;
  walletAddress: string;
  txHash: string;
  amountWei: string;
}

export interface AgentInferenceSummary {
  playerId: string;
  walletAddress: string;
  mode: "0g-serving" | "mock fallback";
  turns: number;
  fallbackTurns: number;
}

export interface MatchReceipt {
  matchId: string;
  gameId: string;
  rulesHash: string;
  rulesUrl: string;
  rulesVersion: string;
  winner: string;
  archiveHash: string;
  archiveUrl?: string;
  payoutTxHash?: string;
  prizePoolAddress: string;
  stakeWei: string;
  totalPoolWei: string;
  fundingTxHashes: FundingTxReceipt[];
  winnerWalletAddress: string;
  payoutAmountWei: string;
  payoutMode: "contract";
  archiveMode: "mock" | "0g";
  agentInference: AgentInferenceSummary[];
  completedAt: string;
}

export interface RoundSummary {
  round: number;
  treasury: number;
  bids: Record<string, number>;
  winner?: string;
  balancesAfter: Record<string, number>;
  messages: Record<string, string>;
}

export interface MatchRenderData {
  players?: Player[];
  round?: number;
  totalRounds?: number;
  phase?: string;
  currentTreasury?: number;
  messages?: Array<{ playerId: string; round: number; text: string; timestamp: string }>;
  pendingBids?: Array<{ playerId: string; submitted: boolean }>;
  revealedBids?: Array<{ playerId: string; amount: number }>;
  history?: RoundSummary[];
  winner?: string;
  prizePoolAddress?: string;
  stakeWei?: string;
  totalPoolWei?: string;
  rulesHash?: string;
  matchStakeWei?: string;
  poolCreationTxHash?: string;
  creationTxHash?: string;
  fullyFunded?: boolean;
  fundingTxHashes?: FundingTxReceipt[];
  prizePoolError?: string;
  storageError?: string;
  payoutError?: string;
  error?: string;
}

export interface MatchUiResponse {
  matchId: string;
  gameId: string;
  status: MatchStatus;
  receipt?: MatchReceipt;
  render: { kind: string; data: MatchRenderData };
  agentLogs: AgentLog[];
  runnerError?: string;
  error?: string;
}

export interface MatchSummary {
  matchId: string;
  gameId: string;
  status: MatchStatus;
  round: number;
  players: Player[];
  winner?: string;
}

export interface DemoMatchResponse {
  matchId: string;
  players: Player[];
}

export async function getHealth(): Promise<{ ok: boolean }> {
  return request("/health");
}

export async function getLiveMatches(): Promise<MatchSummary[]> {
  return request("/matches/live");
}

export async function createDemoMatch(): Promise<DemoMatchResponse> {
  return request("/matches/demo", { method: "POST" });
}

export async function startDemoAgents(matchId: string): Promise<void> {
  await request("/agents/demo/start", {
    method: "POST",
    body: JSON.stringify({ matchId }),
  });
}

export async function getMatchUi(matchId: string): Promise<MatchUiResponse> {
  return request(`/match/${encodeURIComponent(matchId)}/ui`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers =
    init?.body === undefined
      ? init?.headers
      : {
          "content-type": "application/json",
          ...(init?.headers ?? {}),
        };
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data && typeof data.error === "string" ? data.error : response.statusText;
    throw new Error(message);
  }
  return data as T;
}
