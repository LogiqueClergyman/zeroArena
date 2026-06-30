import type { GameSummary } from "./schemas.js";

export async function checkBackendHealth(baseUrl: string): Promise<{ ok: boolean; baseUrl: string; error?: string }> {
  try {
    const response = await fetch(`${cleanBaseUrl(baseUrl)}/health`);
    if (!response.ok) {
      return { ok: false, baseUrl, error: `HTTP ${response.status}` };
    }
    return { ok: true, baseUrl };
  } catch (error) {
    return { ok: false, baseUrl, error: errorMessage(error) };
  }
}

export async function fetchBackendGames(baseUrl: string): Promise<{ games: GameSummary[]; baseUrl: string }> {
  const response = await fetch(`${cleanBaseUrl(baseUrl)}/games`);
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data ? String(data.error) : response.statusText;
    throw new Error(`Backend /games failed: HTTP ${response.status} ${message}`);
  }
  if (!Array.isArray(data)) {
    throw new Error("Backend /games returned non-array JSON");
  }
  return { games: data.map(normalizeGame), baseUrl };
}

export function cleanBaseUrl(baseUrl: string): string {
  return (baseUrl || "http://127.0.0.1:3001").replace(/\/$/, "");
}

function normalizeGame(value: unknown): GameSummary {
  const record = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  return {
    id: String(record.id ?? ""),
    name: String(record.name ?? record.id ?? "Unknown game"),
    minPlayers: Number(record.minPlayers ?? 2),
    maxPlayers: Number(record.maxPlayers ?? 2),
    actionSchema: record.actionSchema,
    rulesHash: stringOrUndefined(record.rulesHash),
    rulesUrl: stringOrUndefined(record.rulesUrl),
    rulesVersion: stringOrUndefined(record.rulesVersion),
    active: record.active === undefined ? true : Boolean(record.active),
  };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
