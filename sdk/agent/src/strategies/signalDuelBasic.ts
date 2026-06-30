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
        move: chooseSignalMove(state),
      },
      source: "deterministic",
      fallbackReason: input.reason,
    };
  }
}

const dialogueLines = [
  "I left you the obvious read for a reason.",
  "Your cleanest counter is already poisoned.",
  "Keep chasing the pattern; it owes me points.",
  "I only need one bad read from you.",
  "That last reveal was bait, not evidence.",
  "The table is louder than my hand.",
] as const;

export function chooseSignalMove(publicState: unknown): SignalMove {
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
  const lessRepeated = validMoves.find((move) => !myPlayedMoves.includes(move));
  return lessRepeated ?? validMoves[0] ?? "rock";
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
