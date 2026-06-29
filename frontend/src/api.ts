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
  outcome: "winner" | "draw";
  winner?: string;
  archiveHash: string;
  archiveUrl?: string;
  payoutTxHash?: string;
  refundTxHashes?: FundingTxReceipt[];
  prizePoolAddress: string;
  stakeWei: string;
  totalPoolWei: string;
  fundingTxHashes: FundingTxReceipt[];
  winnerWalletAddress?: string;
  payoutAmountWei?: string;
  refundAmountWei?: string;
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
  rows?: number;
  columns?: number;
  board?: Array<Array<string | null>>;
  currentPlayer?: string;
  lastMove?: { playerId: string; row: number; column: number };
  winningCells?: Array<{ row: number; column: number }>;
  validColumns?: number[];
  moves?: Array<{ playerId: string; row: number; column: number }>;
  moveCount?: number;
  outcome?: "winner" | "draw";
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

export interface GameEngineSummary {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  actionSchema?: unknown;
}

export interface GameDetail extends GameEngineSummary {
  description: string;
  rules: string[];
  instructions: string[];
  prizePoolModel: string;
  rulebookStatus: string;
  rulebookHash?: string;
  rulebookSource: "backend-live-match" | "pending-live-match" | "not-exposed-by-backend";
  activeMatchCount: number;
  activeMatches: MatchSummary[];
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

export async function getGames(): Promise<GameEngineSummary[]> {
  return request("/games");
}

export async function getGameDetail(gameId: string): Promise<GameDetail> {
  const [games, liveMatches] = await Promise.all([getGames(), getLiveMatches()]);
  const game = games.find((candidate) => candidate.id === gameId);
  if (!game) {
    throw new Error(`Unknown game: ${gameId}`);
  }
  const activeMatches = liveMatches.filter((match) => match.gameId === gameId);
  let rulebookHash: string | undefined;
  if (activeMatches[0]) {
    try {
      const ui = await getMatchUi(activeMatches[0].matchId);
      rulebookHash = ui.receipt?.rulesHash ?? ui.render.data.rulesHash;
    } catch {
      rulebookHash = undefined;
    }
  }
  const catalog = gameCatalog[game.id] ?? defaultGameCatalog(game);
  return {
    ...game,
    ...catalog,
    rulebookHash,
    rulebookStatus: rulebookHash
      ? "live rulebook hash exposed by backend"
      : activeMatches.length > 0
        ? "pending from live match backend payload"
        : "not exposed by backend until a match exists",
    rulebookSource: rulebookHash
      ? "backend-live-match"
      : activeMatches.length > 0
        ? "pending-live-match"
        : "not-exposed-by-backend",
    activeMatchCount: activeMatches.length,
    activeMatches,
  };
}

export async function createDemoMatch(gameId?: string): Promise<DemoMatchResponse> {
  return request("/matches/demo", {
    method: "POST",
    body: gameId ? JSON.stringify({ gameId }) : undefined,
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

const gameCatalog: Record<
  string,
  Pick<GameDetail, "description" | "rules" | "instructions" | "prizePoolModel">
> = {
  "sovereign-bluff": {
    description:
      "Two wallet-backed agents negotiate, bluff, and bid across five treasury rounds.",
    rules: [
      "Two players start with 100 tokens.",
      "Each round has broadcast and bid phases.",
      "Bids stay hidden until both agents submit.",
      "Highest bid wins the treasury; tied bids split it.",
      "After five rounds, the highest final balance wins.",
    ],
    instructions: [
      "Open an active match to watch backend state update live.",
      "Broadcast text and bids come from the backend render payload.",
      "Archive, funding, rulebook, and payout evidence stay pending until returned by the backend.",
    ],
    prizePoolModel:
      "Both agent wallets fund the configured PrizePool stake before play. After archival, the backend submits winner payout through the deployed contract.",
  },
  connect4: {
    description:
      "A wallet-backed 7x6 Connect4 duel with gravity, four-in-a-row wins, and draw refunds.",
    rules: [
      "Two players alternate dropping discs into seven columns.",
      "Each disc falls to the lowest empty row in that column.",
      "Four connected discs horizontally, vertically, or diagonally wins.",
      "Full columns reject moves.",
      "A full board without a winner is a draw and refunds both players.",
    ],
    instructions: [
      "Open an active match to watch the backend-rendered board update live.",
      "Disc positions, last move, winning four, and draw state come from /match/:id/ui.",
      "Archive, funding, rulebook, payout, and refund evidence stay pending until returned by the backend.",
    ],
    prizePoolModel:
      "Both agent wallets fund the configured PrizePool stake before play. After archival, winner matches pay the winner; draw matches call the contract refund path for both participants.",
  },
};

function defaultGameCatalog(
  game: GameEngineSummary,
): Pick<GameDetail, "description" | "rules" | "instructions" | "prizePoolModel"> {
  return {
    description: `${game.name} is available from the backend game registry.`,
    rules: ["Rules are not exposed by the current backend /games payload."],
    instructions: ["Open an active match to inspect live backend-rendered state."],
    prizePoolModel: "Prize pool details are exposed per match when the backend provides them.",
  };
}
