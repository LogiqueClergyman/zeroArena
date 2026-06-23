import type { ValidateFunction } from "ajv";
import type { LLMProvider } from "./providers/LLMProvider.js";
import { MockProvider } from "./providers/MockProvider.js";

export interface AgentStrategy {
  readonly playerId: string;
  readonly name: string;
  readonly walletAddress: string;
  readonly privateKeyRef: string;
  decide(input: {
    gameId: string;
    publicState: unknown;
    actionSchema: unknown;
    playerId: string;
    validationError?: string;
  }): Promise<AgentDecision>;
}

export interface AgentDecision {
  action: unknown;
  log: AgentTurnLog;
}

export interface AgentTurnLog {
  playerId: string;
  walletAddress: string;
  inferenceMode: "0g-serving" | "mock fallback";
  provider: string;
  model: string;
  latencyMs: number;
  validationResult: { ok: boolean; error?: string };
  fallbackReason?: string;
}

export interface DemoAgentOptions {
  playerId: string;
  name: string;
  walletAddress: string;
  privateKeyRef: string;
  persona: string;
  provider: LLMProvider;
  allowMockFallback: boolean;
  validatorForSchema: (schema: unknown) => ValidateFunction;
}

class DemoAgent implements AgentStrategy {
  private readonly fallback = new MockProvider();

  constructor(private readonly options: DemoAgentOptions) {}

  get playerId(): string {
    return this.options.playerId;
  }

  get name(): string {
    return this.options.name;
  }

  get walletAddress(): string {
    return this.options.walletAddress;
  }

  get privateKeyRef(): string {
    return this.options.privateKeyRef;
  }

  async decide(input: {
    gameId: string;
    publicState: unknown;
    actionSchema: unknown;
    playerId: string;
    validationError?: string;
  }): Promise<AgentDecision> {
    const validate = this.options.validatorForSchema(input.actionSchema);
    let lastReason: string | undefined;
    let dialogueRetryUsed = false;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const prompt = this.buildPrompt({ ...input, validationError: lastReason ?? input.validationError });
        const completion = await this.options.provider.complete({
          prompt,
          walletAddress: this.options.walletAddress,
          privateKeyRef: this.options.privateKeyRef,
        });
        const action = parseJsonOnly(completion.text);
        if (validate(action)) {
          const dialogueCheck = validateDialogueAction(action, input.publicState);
          if (!dialogueCheck.ok) {
            lastReason = `0G output failed dialogue validation on attempt ${attempt}: ${dialogueCheck.error}`;
            if (!dialogueRetryUsed) {
              dialogueRetryUsed = true;
              continue;
            }
            const repairedAction = repairBroadcastAction(action, input.publicState, this.options.name);
            if (validate(repairedAction)) {
              return {
                action: repairedAction,
                log: {
                  playerId: this.options.playerId,
                  walletAddress: this.options.walletAddress,
                  inferenceMode:
                    this.options.provider.mode === "0g-serving" ? "0g-serving" : "mock fallback",
                  provider: completion.provider,
                  model: completion.model,
                  latencyMs: completion.latencyMs,
                  validationResult: { ok: true },
                  fallbackReason: `${lastReason}; used demo-safe broadcast variation after one retry`,
                },
              };
            }
            continue;
          }
          return {
            action,
            log: {
              playerId: this.options.playerId,
              walletAddress: this.options.walletAddress,
              inferenceMode:
                this.options.provider.mode === "0g-serving" ? "0g-serving" : "mock fallback",
              provider: completion.provider,
              model: completion.model,
              latencyMs: completion.latencyMs,
              validationResult: { ok: true },
            },
          };
        }
        lastReason = `0G output failed schema validation on attempt ${attempt}: ${formatAjvError(validate.errors)}`;
      } catch (error) {
        lastReason = `0G inference failed on attempt ${attempt}: ${errorMessage(error)}`;
      }
    }

    if (!this.options.allowMockFallback) {
      throw new Error(lastReason ?? "0G inference failed and mock fallback is disabled");
    }

    const prompt = this.buildPrompt({ ...input, validationError: lastReason ?? input.validationError });
    const fallback = await this.fallback.complete({
      prompt,
      walletAddress: this.options.walletAddress,
      privateKeyRef: this.options.privateKeyRef,
    });
    const action = parseJsonOnly(fallback.text);
    const ok = validate(action);
    return {
      action,
      log: {
        playerId: this.options.playerId,
        walletAddress: this.options.walletAddress,
        inferenceMode: "mock fallback",
        provider: fallback.provider,
        model: fallback.model,
        latencyMs: fallback.latencyMs,
        validationResult: ok
          ? { ok: true }
          : { ok: false, error: formatAjvError(validate.errors) },
        fallbackReason: lastReason ?? "0G provider unavailable",
      },
    };
  }

  private buildPrompt(input: {
    gameId: string;
    publicState: unknown;
    actionSchema: unknown;
    playerId: string;
    validationError?: string;
  }): string {
    const phase = publicStatePhase(input.publicState);
    const myBalance = publicStateNumber(input.publicState, "myBalance");
    const currentTreasury = publicStateNumber(input.publicState, "currentTreasury");
    const currentActionSchema = actionSchemaForPhase(phase);
    const strategicBrief = buildStrategicBrief(input.publicState);
    const broadcastProgress = buildBroadcastProgress(input.publicState);
    const styleGuidance = buildStyleGuidance(this.options.name);
    const allowedAction =
      phase === "broadcast"
        ? 'Only return {"phase":"broadcast","message":"..."} for this turn. Do not bid. The message must be in-character speech directed at the opponent, not a description of a tactic.'
        : phase === "bid"
          ? `Only return {"phase":"bid","amount":integer} for this turn. The bid amount must be an integer from 0 to ${myBalance ?? "myBalance"} inclusive. Do not broadcast.`
          : "Return only a legal action for the current phase.";
    return [
      `AGENT: ${this.options.name}`,
      `PERSONA: ${this.options.persona}`,
      `PLAYER_ID: ${input.playerId}`,
      "You are playing Sovereign Bluff. Choose exactly one legal action for the current phase.",
      `STRATEGIC_BRIEF: ${strategicBrief}`,
      broadcastProgress ? `BROADCAST_PROGRESS: ${broadcastProgress}` : undefined,
      `STYLE_GUIDANCE: ${styleGuidance}`,
      "Use the full PUBLIC_STATE, especially previousRounds and conversation. Treat the opponent as remembering your earlier messages.",
      "Your broadcast is not decoration and not just a taunt. Pick exactly one tactic: false commitment, peace offer, revenge threat, fake weakness, flattery, trap, apology, bargain, or intimidation.",
      "Do not describe the tactic. Do not start with verbs like offer, threaten, flatter, apologize, bluff, broadcast, or propose. Speak the line directly.",
      "Make the tactic legible in the message, but do not reuse wording already present in PUBLIC_STATE.",
      "If you reference history, use it to change the opponent's next bid. Do not say generic phrases like 'last round' unless naming the consequence.",
      "If this is your second broadcast in the round, respond to the opponent's current-round message: accept, reject, twist, expose, or counteroffer.",
      "Do not produce isolated generic taunts. Every message should create pressure, invite cooperation, disguise intent, or punish a pattern.",
      "Never repeat any message already in currentRoundConversation or conversation. If the opponent says a phrase, do not echo it.",
      "Write like a rival at a high-stakes arena table, not like a status logger.",
      "Do not say you are broadcasting, bidding, maintaining balance, following strategy, choosing an action, being generous, running out of patience, or telling them to bid wisely.",
      "Do not mention JSON, schemas, phases, balances, or implementation details in the message.",
      "Forbidden stale phrases: generous share, my patience, bid wisely, face the consequences, prove your worth, revised terms, cooperation now costs proof, no copied treaty.",
      "Do not only insult the opponent. Mix deception, negotiation, fear, restraint, and opportunism across the match.",
      "Broadcast messages should be 12-32 words, concrete, and strategically useful.",
      phase === "bid"
        ? "BID_REASONING_REQUIREMENT: Before choosing amount internally, judge opponent messages as truth, bluff, trap, or bargain. Adjust the bid accordingly; do not blindly trust or ignore them."
        : undefined,
      phase === "bid"
        ? "If opponent proposed cooperation, decide whether betrayal is profitable. If opponent threatened a high bid, decide whether to let them overpay or call it."
        : undefined,
      `CURRENT_PHASE: ${phase ?? "unknown"}`,
      myBalance === undefined ? undefined : `MY_BALANCE: ${myBalance}`,
      currentTreasury === undefined ? undefined : `CURRENT_TREASURY: ${currentTreasury}`,
      `ALLOWED_ACTION: ${allowedAction}`,
      phase === "broadcast"
        ? "ONLY_VALID_JSON_FOR_THIS_TURN: {\"phase\":\"broadcast\",\"message\":\"...\"}"
        : undefined,
      phase === "bid" ? "ONLY_VALID_JSON_FOR_THIS_TURN: {\"phase\":\"bid\",\"amount\":integer}" : undefined,
      phase === "bid"
        ? "This is a bid turn. Any JSON with phase=\"broadcast\" is invalid even if it contains a clever message."
        : undefined,
      phase === "broadcast"
        ? "This is a broadcast turn. Any JSON with phase=\"bid\" is invalid even if it contains a good amount."
        : undefined,
      input.validationError
        ? `CORRECTION_REQUIRED: Your previous action was invalid: ${input.validationError}. Return ONLY the valid ${phase ?? "current"} JSON object for CURRENT_PHASE=${phase ?? "unknown"}. If this is a bid, the corrected amount must be <= ${myBalance ?? "myBalance"}.`
        : undefined,
      `PUBLIC_STATE:${JSON.stringify(input.publicState)}`,
      `CURRENT_ACTION_SCHEMA:${JSON.stringify(currentActionSchema ?? input.actionSchema)}`,
    ].filter(Boolean).join("\n");
  }
}

export function createCautiousAgent(options: Omit<DemoAgentOptions, "persona" | "name">): AgentStrategy {
  return new DemoAgent({
    ...options,
    name: "Vesper",
    persona:
      "Vesper is a cold-blooded archivist queen. She wins by contracts, false truces, selective mercy, and quiet punishment. She preserves reserve, usually bids 20-35 percent of the treasury, and uses broadcasts to make the opponent misprice risk.",
  });
}

export function createAggressiveAgent(
  options: Omit<DemoAgentOptions, "persona" | "name">,
): AgentStrategy {
  return new DemoAgent({
    ...options,
    name: "Knox",
    persona:
      "Knox is a reckless neon pit-fighter. He wins by intimidation, fake all-ins, sudden bargains, and emotional pressure. He usually bids 45-70 percent of the treasury, but backs off when low and uses broadcasts to make surrender look cheaper than contesting.",
  });
}

function parseJsonOnly(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("response was not a single JSON object");
  }
  return JSON.parse(trimmed);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatAjvError(errors: ValidateFunction["errors"]): string {
  return errors?.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ") ?? "";
}

function validateDialogueAction(
  action: unknown,
  publicState: unknown,
): { ok: true } | { ok: false; error: string } {
  if (typeof action !== "object" || action === null || Array.isArray(action)) {
    return { ok: true };
  }
  const record = action as Record<string, unknown>;
  if (record.phase !== "broadcast" || typeof record.message !== "string") {
    return { ok: true };
  }

  const message = normalizeMessage(record.message);
  if (!message) {
    return { ok: false, error: "broadcast message is empty after normalization" };
  }
  const priorMessages = messagesFromPublicState(publicState);
  const duplicate = priorMessages.find((candidate) => isRepeatedMessage(message, normalizeMessage(candidate)));
  if (duplicate) {
    return {
      ok: false,
      error: `broadcast message repeats or closely echoes prior message: ${duplicate}`,
    };
  }
  return { ok: true };
}

function repairBroadcastAction(action: unknown, publicState: unknown, agentName: string): unknown {
  if (typeof action !== "object" || action === null || Array.isArray(action)) {
    return action;
  }
  const record = action as Record<string, unknown>;
  if (record.phase !== "broadcast") {
    return action;
  }
  return {
    ...record,
    message: demoSafeBroadcastVariation(publicState, agentName),
  };
}

function demoSafeBroadcastVariation(publicState: unknown, agentName: string): string {
  const state = typeof publicState === "object" && publicState !== null && !Array.isArray(publicState)
    ? (publicState as Record<string, unknown>)
    : {};
  const round = Number(state.round ?? 0);
  const myCount = Number(state.myBroadcastCount ?? 0);
  const opponentCount = Number(state.opponentBroadcastCount ?? 0);
  const treasury = Number(state.currentTreasury ?? 0);
  const options = agentName === "Knox" ? KNOX_REPAIR_LINES : VESPER_REPAIR_LINES;
  const seed = round * 17 + myCount * 5 + opponentCount * 11 + treasury + hashMessages(publicState);
  const index = Math.abs(seed) % options.length;
  return options[index].replace("{treasury}", String(treasury));
}

function hashMessages(publicState: unknown): number {
  return messagesFromPublicState(publicState)
    .join("|")
    .split("")
    .reduce((total, char) => (total + char.charCodeAt(0)) % 997, 0);
}

function buildStyleGuidance(agentName: string): string {
  if (agentName === "Knox") {
    return "Use short, predatory table-talk. Bargain like a fighter setting a trap. Avoid legal or royal wording.";
  }
  return "Use precise, contractual table-talk. Bargain like an archivist hiding a penalty clause. Avoid arena-brute wording.";
}

const VESPER_REPAIR_LINES = [
  "Take this vault cheaply; the clause I care about matures after your next mistake.",
  "I will leave room for peace here, but betrayal adds interest to every future chest.",
  "Your silence is worth more than your threat. Spend less now and keep me curious.",
  "I can sell restraint on this vault; the receipt becomes expensive if you break it.",
  "Let this chest pass quietly and I may misread your courage on purpose later.",
  "I am not fighting the shiny prize; I am buying the pattern you reveal chasing it.",
  "Keep the table calm and I will pretend your reserve still scares me.",
  "One cheap round can become a treaty, if you stop paying extra for pride.",
  "I marked your appetite already. This chest decides whether I tax it or feed it.",
  "Leave me a clean ledger here and I will let your next lie survive inspection.",
];

const KNOX_REPAIR_LINES = [
  "I can let this one breathe, but only if you stop pretending caution is courage.",
  "Take the small win and I may save the haymaker for a richer chest.",
  "I am selling you quiet for one vault; do not mistake that for mercy.",
  "Push me here and I make the next reveal hurt more than this prize helps.",
  "You want a treaty? Pay for it by underbidding where the crowd can see.",
  "I will look away from this chest if your next move proves you heard me.",
  "Spend big now and I get the pleasure of watching you defend an empty purse.",
  "I can fake restraint longer than you can afford suspicion.",
  "Let the {treasury} pass soft, or I turn the next bid into a public bruise.",
  "Your safest move is boring me. Try heroics and I start charging admission.",
];

function messagesFromPublicState(publicState: unknown): string[] {
  if (typeof publicState !== "object" || publicState === null || Array.isArray(publicState)) {
    return [];
  }
  const state = publicState as Record<string, unknown>;
  const messages: string[] = [];
  for (const key of ["conversation", "currentRoundConversation"]) {
    const entries = state[key];
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        continue;
      }
      const text = (entry as Record<string, unknown>).text;
      if (typeof text === "string") {
        messages.push(text);
      }
    }
  }
  const previousRounds = state.previousRounds;
  if (Array.isArray(previousRounds)) {
    for (const round of previousRounds) {
      if (typeof round !== "object" || round === null || Array.isArray(round)) {
        continue;
      }
      const record = round as Record<string, unknown>;
      for (const key of ["myMessage", "opponentMessage"]) {
        const text = record[key];
        if (typeof text === "string") {
          messages.push(text);
        }
      }
      for (const key of ["myMessages", "opponentMessages"]) {
        const texts = record[key];
        if (Array.isArray(texts)) {
          messages.push(...texts.filter((text): text is string => typeof text === "string"));
        }
      }
    }
  }
  return [...new Set(messages.filter((message) => message.trim()))];
}

function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRepeatedMessage(message: string, candidate: string): boolean {
  if (!message || !candidate) {
    return false;
  }
  if (message === candidate) {
    return true;
  }
  const messageWords = new Set(message.split(" ").filter((word) => word.length > 3));
  const candidateWords = new Set(candidate.split(" ").filter((word) => word.length > 3));
  if (messageWords.size < 4 || candidateWords.size < 4) {
    return false;
  }
  const overlap = [...messageWords].filter((word) => candidateWords.has(word)).length;
  const similarity = overlap / Math.min(messageWords.size, candidateWords.size);
  return similarity >= 0.75;
}

function publicStatePhase(publicState: unknown): string | undefined {
  if (typeof publicState !== "object" || publicState === null || Array.isArray(publicState)) {
    return undefined;
  }
  const phase = (publicState as Record<string, unknown>).phase;
  return typeof phase === "string" ? phase : undefined;
}

function publicStateNumber(publicState: unknown, key: string): number | undefined {
  if (typeof publicState !== "object" || publicState === null || Array.isArray(publicState)) {
    return undefined;
  }
  const value = (publicState as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function buildStrategicBrief(publicState: unknown): string {
  if (typeof publicState !== "object" || publicState === null || Array.isArray(publicState)) {
    return "No readable state. Make a legal, phase-correct action.";
  }
  const state = publicState as Record<string, unknown>;
  const round = Number(state.round ?? 0);
  const totalRounds = Number(state.totalRounds ?? 0);
  const myBalance = Number(state.myBalance ?? 0);
  const opponentBalance = Number(state.opponentBalance ?? 0);
  const treasury = Number(state.currentTreasury ?? 0);
  const previousRounds = Array.isArray(state.previousRounds)
    ? (state.previousRounds as Array<Record<string, unknown>>)
    : [];
  const currentRoundConversation = Array.isArray(state.currentRoundConversation)
    ? (state.currentRoundConversation as Array<Record<string, unknown>>)
    : [];
  const lastRound = previousRounds.at(-1);
  const score =
    myBalance > opponentBalance
      ? `You lead by ${myBalance - opponentBalance}.`
      : opponentBalance > myBalance
        ? `You trail by ${opponentBalance - myBalance}.`
        : "Balances are tied.";
  const pressure =
    opponentBalance <= 0
      ? "Opponent has no spendable balance; exploit that with offers or humiliation, not empty threats."
      : myBalance <= 0
        ? "You have no spendable balance; use negotiation, misdirection, or a desperate bargain."
        : treasury >= Math.max(myBalance, opponentBalance) * 0.6
          ? "This treasury can swing the match; use the message to distort the opponent's risk calculation."
          : "This treasury is modest; consider baiting overpayment or proposing restraint.";
  const last =
    lastRound && typeof lastRound === "object"
      ? `Previous resolved round: treasury ${lastRound.treasury}, you bid ${lastRound.myBid}, opponent bid ${lastRound.opponentBid}, winner ${String(lastRound.winner ?? "tie")}.`
      : "No resolved rounds yet; establish a false pattern or opening bargain.";
  const stage =
    round >= totalRounds
      ? "Final round: credibility can be spent freely."
      : round > 1
        ? "Mid-match: build on, betray, or invert earlier signals."
        : "Opening round: plant a pattern you can exploit later.";
  const currentConversation = currentRoundConversation.length
    ? `Current round messages: ${currentRoundConversation
        .map((message) => `${String(message.speaker ?? "unknown")}: ${String(message.text ?? "")}`)
        .join(" | ")}.`
    : "No current-round messages yet.";
  return [stage, score, pressure, last, currentConversation].join(" ");
}

function buildBroadcastProgress(publicState: unknown): string | undefined {
  if (typeof publicState !== "object" || publicState === null || Array.isArray(publicState)) {
    return undefined;
  }
  const state = publicState as Record<string, unknown>;
  const phase = state.phase;
  if (phase !== "broadcast") {
    return undefined;
  }
  const myCount = Number(state.myBroadcastCount ?? 0);
  const opponentCount = Number(state.opponentBroadcastCount ?? 0);
  const total = Number(state.broadcastTurnsPerPlayer ?? 1);
  if (myCount >= 1) {
    return `This is your follow-up message ${myCount + 1} of ${total}; respond to what the opponent has said this round.`;
  }
  if (opponentCount >= 1) {
    return `Opponent has already spoken ${opponentCount} time(s) this round; answer their offer, threat, or lie.`;
  }
  return `This is your opening message ${myCount + 1} of ${total}; set a trap or offer that can be answered.`;
}

function actionSchemaForPhase(phase: string | undefined): unknown {
  if (phase === "broadcast") {
    return {
      type: "object",
      properties: {
        phase: { const: "broadcast" },
        message: { type: "string", maxLength: 280 },
      },
      required: ["phase", "message"],
      additionalProperties: false,
    };
  }
  if (phase === "bid") {
    return {
      type: "object",
      properties: {
        phase: { const: "bid" },
        amount: { type: "number", minimum: 0 },
      },
      required: ["phase", "amount"],
      additionalProperties: false,
    };
  }
  return undefined;
}
