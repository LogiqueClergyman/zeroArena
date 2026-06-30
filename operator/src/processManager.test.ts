import test from "node:test";
import assert from "node:assert/strict";
import { createRedactor, ProcessManager } from "./processManager.js";

test("redacts configured secrets and raw private-key-shaped values", () => {
  const redact = createRedactor(["super-secret-value"]);
  const line = redact("key=super-secret-value raw=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(line.includes("super-secret-value"), false);
  assert.equal(line.includes("aaaaaaaa"), false);
});

test("command preview masks private key env", () => {
  const preview = new ProcessManager(process.cwd()).commandPreview({
    id: "cfg",
    label: "Alpha",
    gameId: "connect4",
    strategy: "connect4-basic",
    walletAddress: "0x00000000000000000000000000000000000000a1",
    privateKey: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    zeroArenaApiUrl: "http://127.0.0.1:3001",
    requestSpacingMs: 7000,
    allowLocalDevAuth: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  assert.equal(preview.env.AGENT_OPERATOR_PRIVATE_KEY.includes("bbbbbbbb"), false);
  assert.equal(preview.env.ZEROARENA_GAME_ID, "connect4");
});
