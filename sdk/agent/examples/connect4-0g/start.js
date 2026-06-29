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
    "Play Connect4 to win, not to fill the board.",
    "Return exactly one JSON object: {\"column\": number}.",
    "Choose only from publicState.validColumns.",
    "Board context:",
    "- Row 0 is the top of the board; row 5 is the bottom.",
    "- A move falls to the landingRow for its column.",
    "- DERIVED_STATE_CONTEXT_JSON.columnProfiles gives neutral column height and stack context only.",
    "Required reasoning:",
    "- Inspect the current board before choosing.",
    "- Look for immediate wins.",
    "- Look for immediate opponent threats that must be blocked.",
    "- Otherwise choose a move that improves your position.",
    "Constraints:",
    "- Do not make decorative patterns.",
    "- Do not fill columns for symmetry.",
    "- Do not choose a full column.",
    "- Do not explain the move.",
  ].join("\n")),
  extraContext: ({ publicState, playerId }) => connect4Context(publicState, playerId),
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

function connect4Context(publicState, playerId) {
  const state = asRecord(publicState);
  const board = Array.isArray(state.board) ? state.board : [];
  const rows = typeof state.rows === "number" ? state.rows : board.length;
  const columns = typeof state.columns === "number" ? state.columns : board[0]?.length ?? 0;
  const validColumns = Array.isArray(state.validColumns) ? state.validColumns : [];
  const players = Array.isArray(state.players) ? state.players : [];
  const opponent = players.find((candidate) => candidate !== playerId);
  const profiles = Array.from({ length: columns }, (_, column) => {
    const cellsTopToBottom = board.map((row) => Array.isArray(row) ? row[column] ?? null : null);
    const occupied = cellsTopToBottom.filter((cell) => cell !== null).length;
    const landingRow = validColumns.includes(column) ? rows - occupied - 1 : null;
    return {
      column,
      valid: validColumns.includes(column),
      height: occupied,
      emptySlots: rows - occupied,
      landingRow,
      cellsTopToBottom,
      stackBottomToTop: [...cellsTopToBottom].reverse().filter((cell) => cell !== null),
    };
  });
  return {
    boardOrientation: "rows are top-to-bottom; row 0 is top; highest row index is bottom",
    myPlayerId: playerId,
    opponentPlayerId: opponent,
    rows,
    columns,
    validColumns,
    columnProfiles: profiles,
  };
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
