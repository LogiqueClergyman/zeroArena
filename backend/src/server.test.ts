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
