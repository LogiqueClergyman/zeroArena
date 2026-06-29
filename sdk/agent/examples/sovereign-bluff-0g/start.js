import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import {
  AgentRunner,
  LlmJsonStrategy,
  SovereignBluffBasicStrategy,
  ZeroArenaClient,
  ZeroGServingProvider,
} from "../../dist/index.js";

loadEnv();

const agent = agentArg();
const upper = agent.toUpperCase();
const walletAddress = must(`AGENT_${upper}_WALLET_ADDRESS`);
const privateKey = must(`AGENT_${upper}_PRIVATE_KEY`);
const privateKeyRef = `AGENT_${upper}_PRIVATE_KEY`;
const aggressive = agent === "beta";

console.log(JSON.stringify({ event: "agent_selected", agent, walletAddress }));

const provider = new ZeroGServingProvider({
  rpcUrl: process.env.ZERO_G_EVM_RPC_URL ?? process.env.EVM_RPC_URL ?? "https://evmrpc-testnet.0g.ai",
  providerAddress: process.env.ZERO_G_PROVIDER_ADDRESS,
  model: process.env.ZERO_G_SERVING_MODEL,
  requestSpacingMs: Number(process.env.ZERO_G_INFERENCE_REQUEST_SPACING_MS ?? 7000),
  temperature: Number(process.env.ZERO_G_INFERENCE_TEMPERATURE ?? 0.85),
  topP: Number(process.env.ZERO_G_INFERENCE_TOP_P ?? 0.9),
  privateKeysByRef: { [privateKeyRef]: privateKey },
});

const client = new ZeroArenaClient({
  baseUrl: process.env.ZEROARENA_API_URL ?? "http://127.0.0.1:3001",
  walletAddress,
  privateKey,
});

const fallback = new SovereignBluffBasicStrategy(aggressive ? "aggressive" : "measured");
const runner = new AgentRunner(client, new LlmJsonStrategy({
  provider,
  walletAddress,
  privateKeyRef,
  userPrompt: loadAgentPrompt(aggressive
    ? "Aggressive Sovereign Bluff agent. Use pressure, high bids, and threats, but return legal JSON only."
    : "Cautious Sovereign Bluff agent. Preserve balance, negotiate, and return legal JSON only."),
  fallback,
}), {
  gameId: process.env.ZEROARENA_GAME_ID ?? "sovereign-bluff",
  walletAddress,
  name: aggressive ? "Knox 0G" : "Vesper 0G",
  nearTimeoutMs: 5000,
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
