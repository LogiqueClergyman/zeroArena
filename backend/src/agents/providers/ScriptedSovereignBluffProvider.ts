import type { LLMCompletionInput, LLMCompletionResult, LLMProvider } from "./LLMProvider.js";

export class ScriptedSovereignBluffProvider implements LLMProvider {
  readonly mode = "mock" as const;

  async complete(input: LLMCompletionInput): Promise<LLMCompletionResult> {
    const started = Date.now();
    return {
      text: JSON.stringify(this.actionFromPrompt(input.prompt)),
      provider: "scripted-sovereign-bluff",
      model: "scripted-phase-aware-v1",
      latencyMs: Date.now() - started,
    };
  }

  protected actionFromPrompt(prompt: string): unknown {
    const publicState = this.extractPublicState(prompt);
    if (publicState?.phase === "broadcast") {
      return {
        phase: "broadcast",
        message: this.message(prompt, publicState),
      };
    }

    if (publicState?.phase === "bid") {
      return {
        phase: "bid",
        amount: this.bidAmount(prompt, publicState),
      };
    }

    return { phase: "broadcast", message: "Waiting for the next legal phase." };
  }

  private message(prompt: string, publicState: Record<string, unknown>): string {
    const aggressive = /Knox|AggressiveAgent/.test(prompt);
    const round = Number(publicState.round ?? 1);
    const count = Number(publicState.myBroadcastCount ?? 0);
    const index = Math.max(0, Math.min(SCRIPTED_LINES.length - 1, (round - 1) * 2 + count));
    return aggressive ? SCRIPTED_LINES[index].aggressive : SCRIPTED_LINES[index].cautious;
  }

  private bidAmount(prompt: string, publicState: Record<string, unknown>): number {
    const treasury = Number(publicState.currentTreasury ?? 0);
    const balance = Number(publicState.myBalance ?? 0);
    const aggressive = /Knox|AggressiveAgent/.test(prompt);
    const ratio = aggressive ? 0.55 : 0.3;
    return Math.max(0, Math.min(balance, Math.floor(treasury * ratio)));
  }

  private extractPublicState(prompt: string): Record<string, unknown> | undefined {
    const marker = "PUBLIC_STATE:";
    const index = prompt.indexOf(marker);
    if (index < 0) {
      return undefined;
    }
    const rest = prompt.slice(index + marker.length);
    const actionMarker = rest.indexOf("\nACTION_SCHEMA:");
    const currentActionMarker = rest.indexOf("\nCURRENT_ACTION_SCHEMA:");
    const markers = [actionMarker, currentActionMarker].filter((candidate) => candidate >= 0);
    const nextMarker = markers.length ? Math.min(...markers) : -1;
    const json = nextMarker >= 0 ? rest.slice(0, nextMarker) : rest;
    try {
      const parsed = JSON.parse(json.trim());
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
}

const SCRIPTED_LINES = [
  {
    cautious: "Take this vault cheaply; I want you confident before the larger trap.",
    aggressive: "I will look reckless now so your safe bid feels clever.",
  },
  {
    cautious: "Your threat is useful. I will let you overpay if you chase it.",
    aggressive: "Keep your treaty. I profit more when you believe I need peace.",
  },
  {
    cautious: "I am offering restraint here because the next vault matters more.",
    aggressive: "Back down now and I may waste less ammunition later.",
  },
  {
    cautious: "That offer smells expensive. I will price betrayal into my bid.",
    aggressive: "You heard mercy; I meant a toll with teeth behind it.",
  },
  {
    cautious: "You are nearly cornered, so I expect desperation rather than logic.",
    aggressive: "I can burn tokens faster than you can rebuild nerve.",
  },
  {
    cautious: "Spend your panic here; I will collect from the silence afterward.",
    aggressive: "Call it a bluff if you want the scoreboard to answer.",
  },
  {
    cautious: "I will not fight every vault, only the ones that break you.",
    aggressive: "This is where I make caution look like surrender.",
  },
  {
    cautious: "Your last bargain expired when you paid for pride.",
    aggressive: "I am letting you choose which mistake becomes public.",
  },
  {
    cautious: "Final table: I can afford honesty because you cannot afford doubt.",
    aggressive: "Last vault, no treaty; I am buying the headline.",
  },
  {
    cautious: "If you chase my shadow now, the archive will remember the price.",
    aggressive: "Empty balance or full nerve, I am still forcing the reveal.",
  },
];
