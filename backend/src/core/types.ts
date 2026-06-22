export type MatchStatus =
  | "waiting"
  | "active"
  | "finished"
  | "archived"
  | "paid"
  | "failed";

export type PlayerId = string;

export interface Player {
  id: PlayerId;
  name: string;
  walletAddress: string;
  agentKind: "mock" | "0g-serving";
}

export interface GameState {
  gameId: string;
  board: unknown;
  currentPlayer?: PlayerId;
  players: PlayerId[];
  round: number;
  status: "waiting" | "active" | "finished";
  winner?: PlayerId;
  publicContext?: unknown;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export interface TerminationResult {
  finished: boolean;
  winner?: PlayerId;
  reason?: string;
}

export interface TurnRecord {
  matchId: string;
  round: number;
  phase: string;
  playerId: PlayerId;
  action: unknown;
  publicStateBefore: unknown;
  publicStateAfter: unknown;
  timestamp: string;
}

export interface AgentInferenceSummary {
  playerId: PlayerId;
  walletAddress: string;
  mode: "0g-serving" | "mock fallback";
  turns: number;
  fallbackTurns: number;
}

export interface FundingTxReceipt {
  playerId: PlayerId;
  walletAddress: string;
  txHash: string;
  amountWei: string;
}

export interface MatchReceipt {
  matchId: string;
  gameId: string;
  rulesHash: string;
  rulesUrl: string;
  rulesVersion: string;
  winner: PlayerId;
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

export interface Match {
  id: string;
  gameId: string;
  players: Player[];
  status: MatchStatus;
  state: GameState;
  createdAt: string;
  updatedAt: string;
  receipt?: MatchReceipt;
  failureReason?: string;
}

export interface AgentStateResponse {
  matchId: string;
  gameId: string;
  status: MatchStatus;
  yourTurn: boolean;
  playerId: string;
  publicState: unknown;
  actionSchema: unknown;
  round: number;
  timeoutInMs: number;
  receipt?: MatchReceipt;
}

export interface SubmitMoveResponse {
  ok: boolean;
  match: Match;
  error?: string;
  receipt?: MatchReceipt;
}

export interface MatchSummary {
  matchId: string;
  gameId: string;
  status: MatchStatus;
  round: number;
  players: Player[];
  winner?: PlayerId;
}
