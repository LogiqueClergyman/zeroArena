import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ConfigStore } from "./configStore.js";
import { validateConfig } from "./schemas.js";

test("validates required 0G fields", () => {
  const issues = validateConfig({
    label: "Alpha",
    gameId: "connect4",
    strategy: "connect4-0g",
    walletAddress: "0xabc",
    privateKey: "0x123",
    zeroArenaApiUrl: "http://127.0.0.1:3001",
    requestSpacingMs: 7000,
    allowLocalDevAuth: false,
  });
  assert.equal(issues.some((issue) => issue.field === "zeroGProviderAddress"), true);
  assert.equal(issues.some((issue) => issue.field === "prompt"), true);
});

test("stores configs and masks private keys on reads", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "zeroarena-operator-"));
  const store = new ConfigStore(resolve(dir, "operator-config.json"));
  const saved = await store.upsert({
    label: "Alpha",
    gameId: "connect4",
    strategy: "connect4-basic",
    walletAddress: "0x00000000000000000000000000000000000000a1",
    privateKey: "0x1111111111111111111111111111111111111111111111111111111111111111",
    zeroArenaApiUrl: "http://127.0.0.1:3001",
    requestSpacingMs: 7000,
    allowLocalDevAuth: false,
  });
  assert.equal(saved.hasPrivateKey, true);
  assert.notEqual(saved.privateKey, "0x1111111111111111111111111111111111111111111111111111111111111111");
  const raw = await store.get(saved.id);
  assert.equal(raw?.privateKey?.startsWith("0x1111"), true);
});
