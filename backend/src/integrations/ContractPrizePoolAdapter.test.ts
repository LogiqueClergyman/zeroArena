import assert from "node:assert/strict";
import { test } from "node:test";
import { Wallet } from "ethers";
import { privateKeyRefForWallet } from "./ContractPrizePoolAdapter.js";

test("contract prize pool funding key lookup follows wallet address, not player side", () => {
  const alpha = Wallet.createRandom();
  const beta = Wallet.createRandom();

  assert.equal(
    privateKeyRefForWallet(beta.address, {
      AGENT_ALPHA_PRIVATE_KEY: alpha.privateKey,
      AGENT_BETA_PRIVATE_KEY: beta.privateKey,
    }),
    "AGENT_BETA_PRIVATE_KEY",
  );
  assert.equal(
    privateKeyRefForWallet(alpha.address, {
      AGENT_ALPHA_PRIVATE_KEY: alpha.privateKey,
      AGENT_BETA_PRIVATE_KEY: beta.privateKey,
    }),
    "AGENT_ALPHA_PRIVATE_KEY",
  );
});

test("contract prize pool funding key lookup fails clearly when no key matches wallet", () => {
  const alpha = Wallet.createRandom();
  const unknown = Wallet.createRandom();

  assert.throws(
    () =>
      privateKeyRefForWallet(unknown.address, {
        AGENT_ALPHA_PRIVATE_KEY: alpha.privateKey,
      }),
    /No configured private key matches/,
  );
});
