import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import {
  AgentRunner,
  LlmJsonStrategy,
  SignalDuelBasicStrategy,
  ZeroArenaClient,
  ZeroGServingProvider,
} from "../../dist/index.js";

loadEnv();

const agent = agentArg();
const upper = agent.toUpperCase();
const walletAddress = must(`AGENT_${upper}_WALLET_ADDRESS`);
const privateKey = must(`AGENT_${upper}_PRIVATE_KEY`);
const privateKeyRef = `AGENT_${upper}_PRIVATE_KEY`;
const persona = signalDuelPersona(agent);

console.log(JSON.stringify({ event: "agent_selected", agent, walletAddress }));

const provider = new ZeroGServingProvider({
  rpcUrl: process.env.ZERO_G_EVM_RPC_URL ?? process.env.EVM_RPC_URL ?? "https://evmrpc-testnet.0g.ai",
  providerAddress: process.env.ZERO_G_PROVIDER_ADDRESS,
  model: process.env.ZERO_G_SERVING_MODEL,
  requestSpacingMs: Number(process.env.ZERO_G_INFERENCE_REQUEST_SPACING_MS ?? 7000),
  temperature: numberOrUndefined(process.env.ZERO_G_INFERENCE_TEMPERATURE),
  topP: numberOrUndefined(process.env.ZERO_G_INFERENCE_TOP_P),
  privateKeysByRef: { [privateKeyRef]: privateKey },
});

const client = new ZeroArenaClient({
  baseUrl: process.env.ZEROARENA_API_URL ?? "http://127.0.0.1:3001",
  walletAddress,
  privateKey,
});

const runner = new AgentRunner(client, new LlmJsonStrategy({
  provider,
  walletAddress,
  privateKeyRef,
  userPrompt: [persona, loadAgentPrompt(defaultSignalDuelPrompt())].join("\n\n"),
  extraContext: ({ publicState }) => signalDuelExtraContext(publicState, persona),
  promptPublicState: ({ publicState }) => compactSignalDuelPublicState(publicState),
  validateAction: ({ action, publicState }) => validateSignalDuelAction(action, publicState),
  maxQualityAttempts: 3,
  debugThoughts: booleanFromEnv(process.env.ZEROARENA_DEBUG_THOUGHTS, true),
  fallback: new SignalDuelBasicStrategy(),
}), {
  gameId: process.env.ZEROARENA_GAME_ID ?? "signal-duel",
  walletAddress,
  name: agent === "alpha" ? "Alpha Signal 0G" : "Beta Signal 0G",
  nearTimeoutMs: 5000,
});

await runner.run();

function defaultSignalDuelPrompt() {
  return [
    "You are playing Signal Duel.",
    "Each player started with one rock, one paper, one scissors, plus one unknown duplicate.",
    "You can see your remaining inventory and opponent played moves.",
    "Infer from dialogue and revealed moves, but do not assume hidden inventory.",
    "During dialogue, respond to the current round context: prior reveals, score, opponent's last line, and token pressure.",
    "Dialogue should be a real bluff: make a plausible claim about their likely inventory or next move, then nudge them toward a bad read.",
    "Good style: \"You spent paper early, so I think you're sitting on rock pressure. I might cover that with paper.\"",
    "Good style: \"If your duplicate is scissors, this is where you cash it. I'm pricing that in.\"",
    "You may lie about your intended move, but do not reliably reveal your actual committed move.",
    "Do not use empty hype phrases such as 'ultimate surprise', 'unexpected challenge', 'prepare to be shocked', 'think again', 'curiosity', or 'something up my sleeve'.",
    "During commit, do not choose the generic middle/default option just because both agents see similar state.",
    "If evidence is weak, follow your private persona bias so the agents do not mirror each other.",
    "During commit, return only JSON with a legal remaining move from publicState.validMoves.",
    "Never explain your action outside JSON.",
  ].join("\n");
}

function signalDuelPersona(selectedAgent) {
  if (selectedAgent === "beta") {
    return [
      "Agent persona: Volt Index.",
      "Voice: brash arcade hustler, sharp and impatient.",
      "Dialogue style: table-talk bluff with fake certainty and concrete inventory reads in 1-2 sentences.",
      "Private commit bias when evidence is weak: prefer rock pressure, then scissors, then paper if legal.",
      "Never use bland lines like 'I will play rock' or 'I'll play paper'.",
    ].join("\n");
  }
  return [
    "Agent persona: Glasswire.",
    "Voice: cold card-table analyst with clipped confidence.",
    "Dialogue style: quiet misdirection with concrete inventory reads and controlled lies in 1-2 sentences.",
    "Private commit bias when evidence is weak: prefer scissors pressure, then paper, then rock if legal.",
    "Never use bland lines like 'I will play rock' or 'I'll play paper'.",
  ].join("\n");
}

function signalDuelExtraContext(publicState, personaText) {
  const state = compactSignalDuelPublicState(publicState);
  const phase = state.phase;
  const privatePolicy = agent === "beta"
    ? "If public evidence is weak, lean rock > scissors > paper when legal. Do not mirror the opponent's obvious default."
    : "If public evidence is weak, lean scissors > paper > rock when legal. Do not mirror the opponent's obvious default.";
  if (phase === "dialogue") {
    return {
      currentPhase: "dialogue",
      privatePolicy,
      compactPublicFacts: state,
      legalOutput: { phase: "dialogue", message: "1-2 natural bluff sentences grounded in token/inventory facts" },
      invalidThisTurn: ["commit actions", "move fields", "literal move announcements"],
      dialogueGoal: "make a plausible but not necessarily truthful inventory read, then bait the opponent into covering the wrong threat",
      styleRules: [
        "Use 1-2 natural sentences, 80-190 characters total.",
        "Mention at least one concrete game noun: rock, paper, scissors, duplicate, extra, token, reveal, spent, inventory, or score.",
        "It is okay to say what you want them to believe you will play, as a bluff.",
        "Do not say 'surprise', 'unexpected', 'prepare', 'shock', 'think again', 'curiosity', or 'sleeve'.",
      ],
    };
  }
  if (phase === "commit") {
    return {
      currentPhase: "commit",
      privatePolicy,
      compactPublicFacts: state,
      validMoves: Array.isArray(state.validMoves) ? state.validMoves : [],
      legalOutput: { phase: "commit", move: "one value from validMoves" },
      invalidThisTurn: ["dialogue actions", "message fields", "moves not in validMoves"],
      commitGoal: "choose privately using visible facts, your own remaining inventory, and your private bias when evidence is weak",
      thoughtGoal: "include a short inferred opponent range in your thought, derived only from opponentPlayedMoves and dialogue",
    };
  }
  return { persona: personaText };
}

function validateSignalDuelAction(action, publicState) {
  const state = compactSignalDuelPublicState(publicState);
  if (!action || typeof action !== "object") {
    return { ok: true };
  }
  if (state.phase !== "dialogue" || action.phase !== "dialogue") {
    return { ok: true };
  }
  const message = typeof action.message === "string" ? action.message.trim() : "";
  const lower = message.toLowerCase();
  const banned = [
    "ultimate surprise",
    "unexpected challenge",
    "prepare to be shocked",
    "think again",
    "curiosity",
    "something up my sleeve",
    "anything you throw",
    "holding back something powerful",
    "mirrors mine",
    "leave you reeling",
  ];
  if (message.length < 70) {
    return { ok: false, error: "dialogue is too short; use a real bluff with a concrete inventory read" };
  }
  if (banned.some((phrase) => lower.includes(phrase))) {
    return { ok: false, error: "dialogue used generic taunt phrasing instead of game-specific bluffing" };
  }
  if (!/\b(rock|paper|scissors|duplicate|extra|token|inventory|reveal|revealed|spent|score|round)\b/i.test(message)) {
    return { ok: false, error: "dialogue must mention a concrete Signal Duel game fact or token" };
  }
  if (!/\b(i think|i believe|you have|you might|you probably|if your|because|since|spent|revealed|duplicate)\b/i.test(message)) {
    return { ok: false, error: "dialogue must sound like a reasoned bluff, not a generic taunt" };
  }
  return { ok: true };
}

function compactSignalDuelPublicState(publicState) {
  const state = publicState && typeof publicState === "object" ? publicState : {};
  const dialogue = Array.isArray(state.dialogue) ? state.dialogue : [];
  const roundHistory = Array.isArray(state.roundHistory) ? state.roundHistory : [];
  const currentRoundDialogue = dialogue
    .filter((line) => line && typeof line === "object" && line.round === state.round)
    .slice(-4)
    .map((line) => ({
      playerId: line.playerId,
      message: line.message,
    }));
  const opponentLastLine = [...dialogue]
    .reverse()
    .find((line) => line && typeof line === "object" && line.playerId === state.opponentPlayerId);
  const lastRound = roundHistory.at(-1);

  return {
    phase: state.phase,
    round: state.round,
    totalRounds: state.totalRounds,
    currentPlayer: state.currentPlayer,
    myPlayerId: state.myPlayerId,
    opponentPlayerId: state.opponentPlayerId,
    scores: state.scores,
    myInventory: state.myInventory,
    myPlayedMoves: state.myPlayedMoves,
    opponentPlayedMoves: state.opponentPlayedMoves,
    validMoves: state.validMoves,
    messagesRemainingThisRound: state.messagesRemainingThisRound,
    hasCommitted: state.hasCommitted,
    opponentCommitted: state.opponentCommitted,
    opponentLastLine: opponentLastLine ? { message: opponentLastLine.message } : undefined,
    currentRoundDialogue,
    lastRound: lastRound
      ? {
          round: lastRound.round,
          moves: lastRound.moves,
          winner: lastRound.winner,
          result: lastRound.result,
          scoresAfter: lastRound.scoresAfter,
        }
      : undefined,
  };
}

function must(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function loadAgentPrompt(defaultPrompt) {
  const file =
    process.env[`AGENT_${upper}_PROMPT_FILE`] ??
    process.env.ZEROARENA_AGENT_PROMPT_FILE;
  if (file) {
    return readFileSync(file, "utf8");
  }
  return process.env[`AGENT_${upper}_PROMPT`] ??
    process.env.ZEROARENA_AGENT_PROMPT ??
    defaultPrompt;
}

function arg(name) {
  return process.argv.slice(2).find((value) => value === "alpha" || value === "beta");
}

function agentArg() {
  return arg("--agent") ?? "alpha";
}

function numberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function booleanFromEnv(value, fallback) {
  if (value === undefined || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
