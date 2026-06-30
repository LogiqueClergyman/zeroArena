import { execFileSync, spawn } from "node:child_process";
import process from "node:process";

const root = process.cwd();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const port = process.env.ZEROARENA_SIGNAL_DUEL_E2E_PORT ?? "3102";
const baseUrl = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  PORT: port,
  LOCAL_DEV_ALLOW_MOCKS: "true",
  LOCAL_DEV_PRIZE_POOL: "mock",
  AGENT_INFERENCE_MODE: "mock",
  ARCHIVE_MODE: "mock",
  PAYOUT_MODE: "contract",
  MATCH_STAKE_WEI: process.env.MATCH_STAKE_WEI ?? "1000",
  ZEROARENA_API_URL: baseUrl,
  ZEROARENA_LOCAL_DEV_AUTH: "true",
  ZEROARENA_GAME_ID: "signal-duel",
  AGENT_ALPHA_WALLET_ADDRESS:
    process.env.AGENT_ALPHA_WALLET_ADDRESS ?? "0x00000000000000000000000000000000000000a1",
  AGENT_BETA_WALLET_ADDRESS:
    process.env.AGENT_BETA_WALLET_ADDRESS ?? "0x00000000000000000000000000000000000000b2",
};

runNpm(["run", "build", "--prefix", "backend"]);
runNpm(["run", "build", "--prefix", "sdk/agent"]);

const children = [];
try {
  const backend = spawn(process.execPath, ["dist/server.js"], {
    cwd: `${root}/backend`,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(backend);
  pipeJsonLines(backend.stdout, "backend");
  pipeJsonLines(backend.stderr, "backend-error");
  backend.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(JSON.stringify({ event: "backend_exited", code }));
    }
  });

  await waitForHealth(baseUrl);

  const alpha = startAgent("alpha");
  const beta = startAgent("beta");
  children.push(alpha, beta);

  const receipt = await waitForReceiptFromLiveMatches(baseUrl);
  if (receipt.gameId !== "signal-duel") {
    throw new Error(`Expected signal-duel receipt, got ${receipt.gameId}`);
  }
  if (receipt.outcome !== "winner" && receipt.outcome !== "draw") {
    throw new Error(`Unexpected Signal Duel outcome: ${receipt.outcome}`);
  }
  await assertNoHiddenCommitLeak(baseUrl, receipt.matchId);
  console.log(
    JSON.stringify({
      event: "external_signal_duel_e2e_complete",
      matchId: receipt.matchId,
      outcome: receipt.outcome,
      winner: receipt.winner,
      archiveHash: receipt.archiveHash,
      payoutTxHash: receipt.payoutTxHash,
      refundTxHashes: receipt.refundTxHashes,
    }),
  );
} finally {
  for (const child of children.reverse()) {
    if (!child.killed) {
      child.kill();
    }
  }
}

function startAgent(agent) {
  const child = spawn(process.execPath, ["start.js", agent], {
    cwd: `${root}/sdk/agent/examples/signal-duel-basic`,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeJsonLines(child.stdout, `agent-${agent}`);
  pipeJsonLines(child.stderr, `agent-${agent}-error`);
  return child;
}

function runNpm(args) {
  execFileSync(npm, args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

async function waitForHealth(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the backend listener is ready.
    }
    await delay(500);
  }
  throw new Error(`Backend did not become healthy at ${url}/health`);
}

async function waitForReceiptFromLiveMatches(url) {
  const deadline = Date.now() + Number(process.env.ZEROARENA_E2E_TIMEOUT_MS ?? 90_000);
  const seen = new Set();
  while (Date.now() < deadline) {
    const live = await fetchJson(`${url}/matches/live`).catch(() => []);
    for (const match of Array.isArray(live) ? live : []) {
      if (match?.gameId === "signal-duel" && match?.matchId) {
        seen.add(match.matchId);
      }
    }
    for (const matchId of seen) {
      const receipt = await fetchJson(`${url}/match/${encodeURIComponent(matchId)}/receipt`).catch(() => undefined);
      if (receipt?.matchId) {
        return receipt;
      }
    }
    await delay(1000);
  }
  throw new Error(`External Signal Duel E2E timed out; observed matches: ${[...seen].join(", ") || "none"}`);
}

async function assertNoHiddenCommitLeak(url, matchId) {
  const history = await fetchJson(`${url}/match/${encodeURIComponent(matchId)}/history`);
  for (const turn of Array.isArray(history) ? history : []) {
    if (turn.phase !== "commit") {
      continue;
    }
    const after = JSON.stringify(turn.publicStateAfter ?? {});
    if (after.includes("committedMoves") || after.includes("extraTokens") || after.includes("opponentInventory")) {
      throw new Error("Signal Duel public state leaked private commit or inventory fields");
    }
    const parsed = turn.publicStateAfter;
    if (parsed?.opponentCommitted === true && Array.isArray(parsed.roundHistory) && parsed.roundHistory.length === 0) {
      continue;
    }
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

function pipeJsonLines(stream, source) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim()) {
        console.log(JSON.stringify({ source, line: line.trim() }));
      }
    }
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
