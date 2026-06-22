import type { TurnRecord } from "../core/types.js";

export interface ArchiveAdapter {
  readonly mode: "mock" | "0g";
  archiveMatch(input: {
    matchId: string;
    gameId: string;
    rulesHash: string;
    rulesUrl: string;
    rulesVersion: string;
    history: TurnRecord[];
    finalState: unknown;
  }): Promise<{ archiveHash: string; url?: string; txHash?: string }>;
}

export function buildCanonicalArchivePayload(input: {
  matchId: string;
  gameId: string;
  rulesHash: string;
  rulesUrl: string;
  rulesVersion: string;
  history: TurnRecord[];
  finalState: unknown;
}): string {
  return `${canonicalJson({
    finalState: input.finalState,
    gameId: input.gameId,
    history: input.history,
    matchId: input.matchId,
    rulesHash: input.rulesHash,
    rulesUrl: input.rulesUrl,
    rulesVersion: input.rulesVersion,
  })}\n`;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
