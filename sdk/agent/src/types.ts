export type MatchStatus = "waiting" | "active" | "finished" | "archived" | "paid" | "failed";

export interface GameSummary {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  actionSchema: unknown;
}

export interface Player {
  id: string;
  name: string;
  walletAddress: string;
  agentKind?: "mock" | "0g-serving";
}

export interface MatchReceipt {
  matchId: string;
  gameId: string;
  outcome: "winner" | "draw";
  winner?: string;
  archiveHash: string;
  archiveUrl?: string;
  payoutTxHash?: string;
  refundTxHashes?: Array<{ playerId: string; walletAddress: string; txHash: string; amountWei: string }>;
  prizePoolAddress: string;
  stakeWei: string;
  totalPoolWei: string;
  fundingTxHashes: Array<{ playerId: string; walletAddress: string; txHash: string; amountWei: string }>;
  payoutAmountWei?: string;
  refundAmountWei?: string;
  archiveMode: "mock" | "0g";
  completedAt: string;
}

export interface AgentState {
  matchId: string;
  gameId: string;
  status: MatchStatus;
  yourTurn: boolean;
  playerId: string;
  publicState: unknown;
  actionSchema: unknown;
  round: number;
  timeoutInMs: number;
  turnStartedAt?: string;
  turnExpiresAt?: string;
  timeoutsUsed: number;
  receipt?: MatchReceipt;
}

export interface JoinLobbyResponse {
  status: "waiting" | "matched";
  gameId: string;
  playerId: string;
  matchId?: string;
  tokenRequired: boolean;
  message?: string;
  players?: Player[];
}

export interface SubmitMoveResponse {
  ok: boolean;
  error?: string;
  receipt?: MatchReceipt;
  match?: { status: MatchStatus; id: string };
}

export interface AgentDecision {
  action: unknown;
  source: "deterministic" | "0g-serving";
  provider?: string;
  model?: string;
  latencyMs?: number;
  fallbackReason?: string;
}

export interface AgentStrategy {
  decide(input: {
    gameId: string;
    publicState: unknown;
    actionSchema: unknown;
    playerId: string;
    validationError?: string;
    deadlineAt: number;
  }): Promise<AgentDecision>;
  fallback?(input: {
    gameId: string;
    publicState: unknown;
    actionSchema: unknown;
    playerId: string;
    reason: string;
  }): AgentDecision;
}

export interface LLMCompletionInput {
  prompt: string;
  walletAddress: string;
  privateKeyRef: string;
  model?: string;
}

export interface LLMCompletionResult {
  text: string;
  provider: string;
  model: string;
  latencyMs: number;
}

export interface LLMProvider {
  readonly mode: "0g-serving" | "mock";
  complete(input: LLMCompletionInput): Promise<LLMCompletionResult>;
}
