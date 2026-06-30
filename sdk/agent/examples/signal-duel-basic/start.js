import { config as loadEnv } from "dotenv";
import { AgentRunner, SignalDuelBasicStrategy, ZeroArenaClient } from "../../dist/index.js";

loadEnv();

const agent = agentArg();
const upper = agent.toUpperCase();
const walletAddress = process.env[`AGENT_${upper}_WALLET_ADDRESS`];
const privateKey = process.env[`AGENT_${upper}_PRIVATE_KEY`];

if (!walletAddress) {
  throw new Error(`Missing AGENT_${upper}_WALLET_ADDRESS`);
}

console.log(JSON.stringify({ event: "agent_selected", agent, walletAddress }));

const client = new ZeroArenaClient({
  baseUrl: process.env.ZEROARENA_API_URL ?? "http://127.0.0.1:3001",
  walletAddress,
  privateKey,
  allowLocalDevAuth: process.env.ZEROARENA_LOCAL_DEV_AUTH === "true",
});

const runner = new AgentRunner(client, new SignalDuelBasicStrategy(), {
  gameId: process.env.ZEROARENA_GAME_ID ?? "signal-duel",
  walletAddress,
  name: agent === "alpha" ? "Alpha Signal" : "Beta Signal",
  nearTimeoutMs: 5000,
});

await runner.run();

function arg(name) {
  return process.argv.slice(2).find((value) => value === "alpha" || value === "beta");
}

function agentArg() {
  return arg("--agent") ?? "alpha";
}
