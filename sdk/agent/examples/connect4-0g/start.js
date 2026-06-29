import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import {
  AgentRunner,
  Connect4BasicStrategy,
  LlmJsonStrategy,
  ZeroArenaClient,
  ZeroGServingProvider,
} from "../../dist/index.js";

loadEnv();

const agent = agentArg();
const upper = agent.toUpperCase();
const walletAddress = must(`AGENT_${upper}_WALLET_ADDRESS`);
const privateKey = must(`AGENT_${upper}_PRIVATE_KEY`);
const privateKeyRef = `AGENT_${upper}_PRIVATE_KEY`;

console.log(JSON.stringify({ event: "agent_selected", agent, walletAddress }));

const provider = new ZeroGServingProvider({
  rpcUrl: process.env.ZERO_G_EVM_RPC_URL ?? process.env.EVM_RPC_URL ?? "https://evmrpc-testnet.0g.ai",
  providerAddress: process.env.ZERO_G_PROVIDER_ADDRESS,
  model: process.env.ZERO_G_SERVING_MODEL,
  requestSpacingMs: Number(process.env.ZERO_G_INFERENCE_REQUEST_SPACING_MS ?? 7000),
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
  userPrompt: loadAgentPrompt([
    "You are playing Connect4 as a competitive demo agent.",
    "Choose exactly one legal move from publicState.validColumns and return only {\"column\": number}.",
    "Move priority:",
    "1. If you can win immediately, play the winning column.",
    "2. If the opponent can win immediately next turn, block that column.",
    "3. Prefer moves that create a threat of four while avoiding moves that let the opponent win immediately.",
    "4. Prefer center columns in this order when no tactic is available: 3, 2, 4, 1, 5, 0, 6.",
    "5. Never choose a full column or a column not listed in validColumns.",
    "Do not explain the move. Do not include markdown or extra keys.",
  ].join("\n")),
  fallback: new Connect4BasicStrategy(),
}), {
  gameId: process.env.ZEROARENA_GAME_ID ?? "connect4",
  walletAddress,
  name: agent === "alpha" ? "Alpha 0G" : "Beta 0G",
});

await runner.run();

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
