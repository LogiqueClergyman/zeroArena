import assert from "node:assert/strict";
import { test } from "node:test";
import { buildServer, validateStartup } from "./server.js";

const realEnv = {
  LOCAL_DEV_ALLOW_MOCKS: "false",
  AGENT_INFERENCE_MODE: "0g-serving",
  ARCHIVE_MODE: "0g",
  PAYOUT_MODE: "contract",
  EVM_RPC_URL: "https://evmrpc-testnet.0g.ai",
  EVM_PRIVATE_KEY: "0x1111111111111111111111111111111111111111111111111111111111111111",
  PRIZE_POOL_ADDRESS: "0x0000000000000000000000000000000000000001",
  MATCH_STAKE_WEI: "1000",
  SOVEREIGN_BLUFF_RULEBOOK_HASH:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  SOVEREIGN_BLUFF_RULEBOOK_URL: "0g://rulebook",
  SOVEREIGN_BLUFF_RULEBOOK_VERSION: "1.0.0",
  CONNECT4_RULEBOOK_HASH:
    "0x2222222222222222222222222222222222222222222222222222222222222222",
  CONNECT4_RULEBOOK_URL: "0g://rulebook-connect4",
  CONNECT4_RULEBOOK_VERSION: "1.0.0",
  SIGNAL_DUEL_RULEBOOK_HASH:
    "0x3333333333333333333333333333333333333333333333333333333333333333",
  SIGNAL_DUEL_RULEBOOK_URL: "0g://rulebook-signal-duel",
  SIGNAL_DUEL_RULEBOOK_VERSION: "1.0.0",
  AGENT_ALPHA_WALLET_ADDRESS: "0x0000000000000000000000000000000000000002",
  AGENT_ALPHA_PRIVATE_KEY: "0x2222222222222222222222222222222222222222222222222222222222222222",
  AGENT_BETA_WALLET_ADDRESS: "0x0000000000000000000000000000000000000003",
  AGENT_BETA_PRIVATE_KEY: "0x3333333333333333333333333333333333333333333333333333333333333333",
  ZERO_G_STORAGE_PRIVATE_KEY: "0x4444444444444444444444444444444444444444444444444444444444444444",
} satisfies NodeJS.ProcessEnv;

test("judged startup requires real inference mode", () => {
  assert.throws(
    () => validateStartup({ ...realEnv, AGENT_INFERENCE_MODE: "mock" }),
    /AGENT_INFERENCE_MODE=0g-serving/,
  );
});

test("judged startup requires real 0G archive mode", () => {
  assert.throws(
    () => validateStartup({ ...realEnv, ARCHIVE_MODE: "mock" }),
    /ARCHIVE_MODE=0g/,
  );
});

test("local dev may opt into mock archive and mock inference explicitly", () => {
  assert.doesNotThrow(() =>
    validateStartup({
      ...realEnv,
      LOCAL_DEV_ALLOW_MOCKS: "true",
      AGENT_INFERENCE_MODE: "mock",
      ARCHIVE_MODE: "mock",
      ZERO_G_STORAGE_PRIVATE_KEY: "",
    }),
  );
});

test("judged startup accepts fully real modes", () => {
  assert.doesNotThrow(() => validateStartup(realEnv));
});

test("server allows the Vite dev frontend origin", async () => {
  const app = await buildServer(realEnv);
  try {
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: {
        origin: "http://localhost:5173",
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["access-control-allow-origin"], "http://localhost:5173");
  } finally {
    await app.close();
  }
});

test("server allows alternate Vite dev ports", async () => {
  const app = await buildServer(realEnv);
  try {
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: {
        origin: "http://localhost:5174",
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["access-control-allow-origin"], "http://localhost:5174");
  } finally {
    await app.close();
  }
});

test("agent state requires bearer token for the requested player wallet", async () => {
  const app = await buildServer({
    LOCAL_DEV_ALLOW_MOCKS: "true",
    LOCAL_DEV_PRIZE_POOL: "mock",
    AGENT_INFERENCE_MODE: "mock",
    ARCHIVE_MODE: "mock",
    PAYOUT_MODE: "contract",
  });
  try {
    const alphaWallet = "0x00000000000000000000000000000000000000a1";
    const betaWallet = "0x00000000000000000000000000000000000000b2";
    const alphaToken = await localDevToken(app, alphaWallet);
    const betaToken = await localDevToken(app, betaWallet);

    const firstJoin = await app.inject({
      method: "POST",
      url: "/lobby/join",
      payload: { gameId: "connect4", walletAddress: alphaWallet, name: "Alpha" },
    });
    assert.equal(firstJoin.statusCode, 200);
    assert.equal((firstJoin.json() as { playerId: string }).playerId, alphaWallet.toLowerCase());
    const joined = await app.inject({
      method: "POST",
      url: "/lobby/join",
      payload: { gameId: "connect4", walletAddress: betaWallet, name: "Beta" },
    });
    assert.equal(joined.statusCode, 200);
    const body = joined.json() as { matchId: string };
    assert.ok(body.matchId);
    const playerId = alphaWallet.toLowerCase();

    const missingAuth = await app.inject({
      method: "GET",
      url: `/match/${body.matchId}/state?playerId=${encodeURIComponent(playerId)}`,
    });
    assert.equal(missingAuth.statusCode, 401);

    const wrongWallet = await app.inject({
      method: "GET",
      url: `/match/${body.matchId}/state?playerId=${encodeURIComponent(playerId)}`,
      headers: { authorization: `Bearer ${betaToken}` },
    });
    assert.equal(wrongWallet.statusCode, 403);

    const ok = await app.inject({
      method: "GET",
      url: `/match/${body.matchId}/state?playerId=${encodeURIComponent(playerId)}`,
      headers: { authorization: `Bearer ${alphaToken}` },
    });
    assert.equal(ok.statusCode, 200);
    assert.equal((ok.json() as { playerId: string }).playerId, playerId);
  } finally {
    await app.close();
  }
});

test("external lobby uses wallet identity regardless of local alpha or beta agent label", async () => {
  const app = await buildServer({
    LOCAL_DEV_ALLOW_MOCKS: "true",
    LOCAL_DEV_PRIZE_POOL: "mock",
    AGENT_INFERENCE_MODE: "mock",
    ARCHIVE_MODE: "mock",
    PAYOUT_MODE: "contract",
  });
  try {
    const alphaWallet = "0x00000000000000000000000000000000000000a1";
    const betaWallet = "0x00000000000000000000000000000000000000b2";
    const waiting = await app.inject({
      method: "POST",
      url: "/lobby/join",
      payload: { gameId: "connect4", walletAddress: betaWallet, name: "Beta" },
    });
    assert.equal(waiting.statusCode, 200);
    assert.equal((waiting.json() as { status: string; playerId: string }).status, "waiting");
    assert.equal((waiting.json() as { playerId: string }).playerId, betaWallet.toLowerCase());

    const matched = await app.inject({
      method: "POST",
      url: "/lobby/join",
      payload: { gameId: "connect4", walletAddress: alphaWallet, name: "Alpha" },
    });
    assert.equal(matched.statusCode, 200);
    const body = matched.json() as {
      status: string;
      playerId: string;
      players: Array<{ id: string; walletAddress: string; name: string }>;
    };
    assert.equal(body.status, "matched");
    assert.equal(body.playerId, alphaWallet.toLowerCase());
    assert.deepEqual(
      body.players.map((player) => player.id),
      [betaWallet.toLowerCase(), alphaWallet.toLowerCase()],
    );
    assert.deepEqual(
      body.players.map((player) => player.name),
      ["Beta", "Alpha"],
    );
  } finally {
    await app.close();
  }
});

async function localDevToken(app: Awaited<ReturnType<typeof buildServer>>, walletAddress: string): Promise<string> {
  const challenge = await app.inject({
    method: "POST",
    url: "/auth/challenge",
    payload: { walletAddress },
  });
  assert.equal(challenge.statusCode, 200);
  const verified = await app.inject({
    method: "POST",
    url: "/auth/verify",
    payload: { walletAddress, signature: "local-dev" },
  });
  assert.equal(verified.statusCode, 200);
  return (verified.json() as { token: string }).token;
}
