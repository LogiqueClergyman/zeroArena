import { execFileSync, spawn } from "node:child_process";
import http from "node:http";
import process from "node:process";

const root = process.cwd();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const operatorPort = Number(process.env.ZEROARENA_OPERATOR_SMOKE_PORT ?? 8898);
const backendPort = Number(process.env.ZEROARENA_OPERATOR_FAKE_BACKEND_PORT ?? 8899);
const operatorUrl = `http://127.0.0.1:${operatorPort}`;
const backendUrl = `http://127.0.0.1:${backendPort}`;
const smokeConfigPath = `.tmp/operator-smoke-${Date.now()}.json`;

runNpm(["run", "build", "--prefix", "sdk/agent"]);
runNpm(["run", "build", "--prefix", "operator"]);

const fakeBackend = http.createServer((request, response) => {
  if (request.url === "/health") {
    json(response, { ok: true });
    return;
  }
  if (request.url === "/games") {
    json(response, [
      {
        id: "connect4",
        name: "Connect Four",
        minPlayers: 2,
        maxPlayers: 2,
        rulesHash: "0xabc",
        rulesUrl: "local-smoke",
        rulesVersion: "smoke",
        active: true,
      },
      {
        id: "sovereign-bluff",
        name: "Sovereign Bluff",
        minPlayers: 2,
        maxPlayers: 2,
        active: true,
      },
    ]);
    return;
  }
  response.writeHead(404);
  response.end();
});

await listen(fakeBackend, backendPort);
const operator = spawn(process.execPath, ["dist/server.js"], {
  cwd: `${root}/operator`,
  env: { ...process.env, OPERATOR_PORT: String(operatorPort), OPERATOR_CONFIG_PATH: smokeConfigPath },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForHealth(operatorUrl);
  const health = await fetchJson(`${operatorUrl}/api/health`);
  if (!health.ok) {
    throw new Error("operator health was not ok");
  }
  const games = await fetchJson(`${operatorUrl}/api/backend/games?baseUrl=${encodeURIComponent(backendUrl)}`);
  if (games.games?.length !== 2) {
    throw new Error(`expected 2 proxied games, got ${games.games?.length ?? 0}`);
  }
  const saved = await postJson(`${operatorUrl}/api/configs`, {
    label: "Smoke Alpha",
    gameId: "connect4",
    strategy: "connect4-basic",
    walletAddress: "0x00000000000000000000000000000000000000a1",
    zeroArenaApiUrl: backendUrl,
    requestSpacingMs: 7000,
    allowLocalDevAuth: true,
  });
  if (!saved.id || saved.hasPrivateKey) {
    throw new Error("unexpected saved config response");
  }
  console.log(JSON.stringify({ event: "operator_smoke_complete", operatorUrl, games: games.games.length, configId: saved.id }));
} finally {
  operator.kill();
  await new Promise((resolve) => fakeBackend.close(resolve));
}

function runNpm(args) {
  execFileSync(npm, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

function listen(server, port) {
  return new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
}

async function waitForHealth(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await delay(400);
  }
  throw new Error(`operator did not become healthy at ${url}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function json(response, body) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
