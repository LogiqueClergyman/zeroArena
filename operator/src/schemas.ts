export type StrategyId = "connect4-basic" | "connect4-0g" | "sovereign-bluff-basic" | "sovereign-bluff-0g";

export interface AgentConfig {
  id: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface MaskedAgentConfig extends Omit<AgentConfig, "privateKey"> {
  privateKey?: string;
  hasPrivateKey: boolean;
}

export interface ValidationIssue {
  field: string;
  message: string;
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

export type AgentStatus =
  | "idle"
  | "starting"
  | "joining"
  | "waiting"
  | "matched"
  | "playing"
  | "finished"
  | "error"
  | "stopped";

export interface GameSummary {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  actionSchema?: unknown;
  rulesHash?: string;
  rulesUrl?: string;
  rulesVersion?: string;
  active?: boolean;
}

export function strategyRequires0G(strategy: StrategyId): boolean {
  return strategy === "connect4-0g" || strategy === "sovereign-bluff-0g";
}

export function validateConfig(input: Partial<AgentConfig>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const required = (field: keyof AgentConfig, label: string = field) => {
    const value = input[field];
    if (value === undefined || value === null || String(value).trim() === "") {
      issues.push({ field, message: `${label} is required` });
    }
  };
  required("label", "agent label");
  required("gameId", "game");
  required("strategy", "strategy");
  required("walletAddress", "wallet address");
  required("zeroArenaApiUrl", "ZeroArena API URL");
  if (!input.allowLocalDevAuth) {
    required("privateKey", "private key");
  }
  if (input.strategy && !strategyMatchesGame(input.strategy, input.gameId)) {
    issues.push({ field: "strategy", message: "strategy is not available for the selected game" });
  }
  if (input.strategy && strategyRequires0G(input.strategy)) {
    required("privateKey", "private key");
    required("zeroGRpcUrl", "0G RPC URL");
    required("zeroGProviderAddress", "0G provider address");
    required("zeroGModel", "0G model");
    if (!input.prompt?.trim()) {
      issues.push({ field: "prompt", message: "prompt/skill text is required for 0G strategy" });
    }
  }
  if (!Number.isFinite(input.requestSpacingMs) || Number(input.requestSpacingMs) < 0) {
    issues.push({ field: "requestSpacingMs", message: "request spacing must be a non-negative number" });
  }
  return issues;
}

export function maskConfig(config: AgentConfig): MaskedAgentConfig {
  const { privateKey, ...rest } = config;
  return {
    ...rest,
    privateKey: privateKey ? maskSecret(privateKey) : undefined,
    hasPrivateKey: Boolean(privateKey),
  };
}

export function maskSecret(value: string): string {
  if (value.length <= 10) {
    return "********";
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function strategyMatchesGame(strategy: StrategyId, gameId: AgentConfig["gameId"] | undefined): boolean {
  if (!gameId) {
    return true;
  }
  if (gameId === "connect4") {
    return strategy === "connect4-basic" || strategy === "connect4-0g";
  }
  return strategy === "sovereign-bluff-basic" || strategy === "sovereign-bluff-0g";
}
