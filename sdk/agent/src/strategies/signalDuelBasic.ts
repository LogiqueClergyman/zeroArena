import type { AgentDecision, AgentStrategy } from "../types.js";

const moveOrder = ["rock", "paper", "scissors"] as const;
type SignalMove = typeof moveOrder[number];

export class SignalDuelBasicStrategy implements AgentStrategy {
  async decide(input: { publicState: unknown; playerId: string }): Promise<AgentDecision> {
    return this.fallback({
      publicState: input.publicState,
      playerId: input.playerId,
      reason: "deterministic Signal Duel strategy",
    });
  }

  fallback(input: { publicState: unknown; reason: string; playerId?: string }): AgentDecision {
    const state = asRecord(input.publicState);
    if (state.phase === "dialogue") {
      return {
        action: {
          phase: "dialogue",
          message: chooseDialogueLine(state, input.playerId),
        },
        source: "deterministic",
        fallbackReason: input.reason,
      };
    }
    return {
      action: {
        phase: "commit",
        move: chooseSignalMove(state, input.playerId),
      },
      source: "deterministic",
      fallbackReason: input.reason,
    };
  }
}

const dialogueLines = [
  "You have to respect the extra rock somewhere, so I might make paper look safer than it is.",
  "If your duplicate is scissors, this is the round you want to spend it. I am already pricing that in.",
  "You spent a clean reveal already, so your inventory story is thinner than your message sounds.",
  "I think you want me covering rock pressure. That makes the obvious counter a little too obvious.",
  "Your last reveal gave me one real fact and one fake trail. I am leaning on the fake trail.",
  "If you are holding a duplicate paper, you need me afraid of rock. I am not giving you that for free.",
] as const;

export function chooseSignalMove(publicState: unknown, playerId?: string): SignalMove {
  const state = asRecord(publicState);
  const validMoves = Array.isArray(state.validMoves)
    ? state.validMoves.filter(isSignalMove)
    : [];
  if (validMoves.length === 0) {
    return "rock";
  }
  const myPlayedMoves = Array.isArray(state.myPlayedMoves)
    ? state.myPlayedMoves.filter(isSignalMove)
    : [];
  const candidates = validMoves.filter((move) => !myPlayedMoves.includes(move));
  const pool = candidates.length > 1 ? candidates : validMoves;
  const round = typeof state.round === "number" ? state.round : 0;
  const playerOffset = playerId ? playerId.charCodeAt(0) : 0;
  return pool[Math.abs(hash(`${playerId ?? ""}:${round}`) + playerOffset) % pool.length] ?? validMoves[0] ?? "rock";
}

function chooseDialogueLine(state: Record<string, unknown>, playerId?: string): string {
  const dialogueCount = Array.isArray(state.dialogue) ? state.dialogue.length : 0;
  const seed = hash(playerId ?? "") + dialogueCount;
  return dialogueLines[Math.abs(seed) % dialogueLines.length];
}

function hash(value: string): number {
  let result = 0;
  for (const char of value) {
    result = (result * 31 + char.charCodeAt(0)) | 0;
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isSignalMove(value: unknown): value is SignalMove {
  return value === "rock" || value === "paper" || value === "scissors";
}
