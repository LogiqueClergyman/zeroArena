import { Wallet } from "ethers";
import type { AgentState, GameSummary, JoinLobbyResponse, MatchReceipt, SubmitMoveResponse } from "./types.js";

export interface ZeroArenaClientOptions {
  baseUrl: string;
  walletAddress: string;
  privateKey?: string;
  token?: string;
  allowLocalDevAuth?: boolean;
}

export class ZeroArenaClient {
  private token?: string;

  constructor(private readonly options: ZeroArenaClientOptions) {
    this.token = options.token;
  }

  async authenticate(): Promise<string> {
    const challenge = await this.request<{ message: string }>("/auth/challenge", {
      method: "POST",
      body: JSON.stringify({ walletAddress: this.options.walletAddress }),
    });
    const signature = this.options.privateKey
      ? await new Wallet(this.options.privateKey).signMessage(challenge.message)
      : this.options.allowLocalDevAuth
        ? "local-dev"
        : undefined;
    if (!signature) {
      throw new Error("Wallet private key is required for auth, unless allowLocalDevAuth=true");
    }
    const verified = await this.request<{ token: string }>("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ walletAddress: this.options.walletAddress, signature }),
    });
    this.token = verified.token;
    return this.token;
  }

  async getGames(): Promise<GameSummary[]> {
    return this.request("/games");
  }

  async joinLobby(gameId: string, walletAddress = this.options.walletAddress, name?: string): Promise<JoinLobbyResponse> {
    return this.request("/lobby/join", {
      method: "POST",
      body: JSON.stringify({ gameId, walletAddress, name }),
    });
  }

  async getMatchState(matchId: string, playerId: string): Promise<AgentState> {
    return this.request(`/match/${encodeURIComponent(matchId)}/state?playerId=${encodeURIComponent(playerId)}`, {
      auth: true,
    });
  }

  async submitMove(matchId: string, playerId: string, action: unknown): Promise<SubmitMoveResponse> {
    return this.request(`/match/${encodeURIComponent(matchId)}/move`, {
      method: "POST",
      body: JSON.stringify({ playerId, action }),
      auth: true,
    });
  }

  async getHistory(matchId: string): Promise<unknown[]> {
    return this.request(`/match/${encodeURIComponent(matchId)}/history`);
  }

  async getReceipt(matchId: string): Promise<MatchReceipt> {
    return this.request(`/match/${encodeURIComponent(matchId)}/receipt`);
  }

  private async request<T>(
    path: string,
    init: RequestInit & { auth?: boolean } = {},
    attempt = 0,
  ): Promise<T> {
    const headers: Record<string, string> = {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...headersToRecord(init.headers),
    };
    if (init.auth) {
      if (!this.token) {
        await this.authenticate();
      }
      headers.authorization = `Bearer ${this.token}`;
    }
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers,
    }).catch((error) => {
      throw new ApiError(path, 0, error instanceof Error ? error.message : String(error));
    });
    const text = await response.text();
    const data = text ? parseJson(text, path) : undefined;
    if (!response.ok) {
      const message = data && typeof data === "object" && "error" in data ? String(data.error) : response.statusText;
      if (isTransient(response.status) && attempt < 4) {
        await sleep(backoffMs(attempt, response.headers.get("retry-after")));
        return this.request<T>(path, init, attempt + 1);
      }
      throw new ApiError(path, response.status, message);
    }
    return data as T;
  }
}

export class ApiError extends Error {
  constructor(
    readonly endpoint: string,
    readonly statusCode: number,
    readonly backendMessage: string,
  ) {
    super(`ZeroArena API error at ${endpoint}: HTTP ${statusCode || "network"} ${backendMessage}`);
  }
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers;
}

function isTransient(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }
  return Math.min(10_000, 500 * 2 ** attempt);
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(path, 0, `Backend returned non-JSON response: ${text.slice(0, 120)}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
