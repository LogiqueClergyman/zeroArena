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
    "During dialogue, bluff or pressure in one concise sentence without stating your literal committed move.",
    "During commit, return only JSON with a legal remaining move from publicState.validMoves.",
    "Never explain your action outside JSON.",
  ].join("\n");
}

function signalDuelPersona(selectedAgent) {
  if (selectedAgent === "beta") {
    return [
      "Agent persona: Volt Index.",
      "Voice: brash arcade hustler, sharp and impatient.",
      "Dialogue style: taunt, fake certainty, and bait the opponent in under 18 words.",
      "Never use bland lines like 'I will play rock' or 'I'll play paper'.",
    ].join("\n");
  }
  return [
    "Agent persona: Glasswire.",
    "Voice: cold card-table analyst with clipped confidence.",
    "Dialogue style: quiet misdirection, precise pressure, and short psychological feints under 18 words.",
    "Never use bland lines like 'I will play rock' or 'I'll play paper'.",
  ].join("\n");
}

function signalDuelExtraContext(publicState, personaText) {
  const state = publicState && typeof publicState === "object" ? publicState : {};
  const phase = state.phase;
  if (phase === "dialogue") {
    return {
      persona: personaText,
      currentPhase: "dialogue",
      legalOutput: { phase: "dialogue", message: "one in-character sentence" },
      invalidThisTurn: ["commit actions", "move fields", "literal move announcements"],
      dialogueGoal: "pressure or misdirect while preserving uncertainty",
    };
  }
  if (phase === "commit") {
    return {
      persona: personaText,
      currentPhase: "commit",
      validMoves: Array.isArray(state.validMoves) ? state.validMoves : [],
      legalOutput: { phase: "commit", move: "one value from validMoves" },
      invalidThisTurn: ["dialogue actions", "message fields", "moves not in validMoves"],
    };
  }
  return { persona: personaText };
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
