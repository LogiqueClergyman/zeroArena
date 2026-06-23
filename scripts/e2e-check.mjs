import { readFileSync } from "node:fs";

const requiredModes = {
  AGENT_INFERENCE_MODE: "0g-serving",
  ARCHIVE_MODE: "0g",
  PAYOUT_MODE: "contract",
};

const requiredEnv = [
  "EVM_RPC_URL",
  "EVM_CHAIN_ID",
  "PRIZE_POOL_ADDRESS",
  "MATCH_STAKE_WEI",
  "AGENT_ALPHA_WALLET_ADDRESS",
  "AGENT_ALPHA_PRIVATE_KEY",
  "AGENT_BETA_WALLET_ADDRESS",
  "AGENT_BETA_PRIVATE_KEY",
  "ZERO_G_STORAGE_PRIVATE_KEY",
  "SOVEREIGN_BLUFF_RULEBOOK_HASH",
  "SOVEREIGN_BLUFF_RULEBOOK_URL",
  "SOVEREIGN_BLUFF_RULEBOOK_VERSION",
];

const failures = [];

for (const [key, expected] of Object.entries(requiredModes)) {
  if (process.env[key] !== expected) {
    failures.push(`${key} must be ${expected}`);
  }
}

for (const key of requiredEnv) {
  if (!process.env[key]) {
    failures.push(`${key} is required`);
  }
}

if (process.env.EVM_CHAIN_ID && process.env.EVM_CHAIN_ID !== "16602") {
  failures.push("EVM_CHAIN_ID must be 16602 for 0G Galileo testnet");
}

await checkWalletFunded("AGENT_ALPHA_WALLET_ADDRESS");
await checkWalletFunded("AGENT_BETA_WALLET_ADDRESS");

const receipt = loadReceipt();
if (!receipt) {
  failures.push("FINAL_RECEIPT_JSON must point to the final receipt JSON file");
} else {
  checkReceipt(receipt);
}

if (failures.length) {
  console.error("E2E checklist failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("E2E checklist passed");

function loadReceipt() {
  const path = process.env.FINAL_RECEIPT_JSON;
  if (!path) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    failures.push(`FINAL_RECEIPT_JSON could not be read: ${errorMessage(error)}`);
    return undefined;
  }
}

function checkReceipt(receipt) {
  if (receipt.archiveMode !== "0g") failures.push("receipt.archiveMode must be 0g");
  if (receipt.payoutMode !== "contract") failures.push("receipt.payoutMode must be contract");
  if (!receipt.archiveHash || String(receipt.archiveHash).startsWith("mock-")) {
    failures.push("receipt.archiveHash must be a real 0G Storage hash");
  }
  if (!receipt.payoutTxHash) failures.push("receipt.payoutTxHash is required");
  if (!receipt.prizePoolAddress) failures.push("receipt.prizePoolAddress is required");
  if (receipt.prizePoolAddress && process.env.PRIZE_POOL_ADDRESS && !sameAddress(receipt.prizePoolAddress, process.env.PRIZE_POOL_ADDRESS)) {
    failures.push("receipt.prizePoolAddress must match PRIZE_POOL_ADDRESS");
  }
  if (String(receipt.stakeWei) !== String(process.env.MATCH_STAKE_WEI)) {
    failures.push("receipt.stakeWei must match MATCH_STAKE_WEI");
  }
  const expectedPool = BigInt(process.env.MATCH_STAKE_WEI || "0") * 2n;
  if (String(receipt.totalPoolWei) !== expectedPool.toString()) {
    failures.push("receipt.totalPoolWei must equal MATCH_STAKE_WEI * 2");
  }
  if (String(receipt.payoutAmountWei) !== expectedPool.toString()) {
    failures.push("receipt.payoutAmountWei must equal MATCH_STAKE_WEI * 2");
  }
  if (!Array.isArray(receipt.fundingTxHashes) || receipt.fundingTxHashes.length !== 2) {
    failures.push("receipt must include both funding transaction hashes");
  } else {
    for (const funding of receipt.fundingTxHashes) {
      if (!funding.txHash) failures.push(`missing funding tx for ${funding.playerId ?? funding.walletAddress}`);
      if (String(funding.amountWei) !== String(process.env.MATCH_STAKE_WEI)) {
        failures.push(`funding amount for ${funding.playerId ?? funding.walletAddress} must match MATCH_STAKE_WEI`);
      }
    }
  }
  if (!Array.isArray(receipt.agentInference) || receipt.agentInference.length !== 2) {
    failures.push("receipt must include both agent inference summaries");
  } else {
    for (const summary of receipt.agentInference) {
      if (summary.mode !== "0g-serving") failures.push(`${summary.playerId} mode must be 0g-serving`);
      if (summary.fallbackTurns !== 0) failures.push(`${summary.playerId} fallbackTurns must be 0`);
      if (!summary.walletAddress) failures.push(`${summary.playerId} walletAddress is required`);
    }
  }
}

async function checkWalletFunded(envKey) {
  const address = process.env[envKey];
  const rpcUrl = process.env.EVM_RPC_URL;
  if (!address || !rpcUrl) return;
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [address, "latest"],
      }),
    });
    const data = await response.json();
    if (data.error) {
      failures.push(`${envKey} balance check failed: ${JSON.stringify(data.error)}`);
      return;
    }
    if (BigInt(data.result ?? "0x0") <= 0n) {
      failures.push(`${envKey} must be funded on 0G Galileo`);
    }
  } catch (error) {
    failures.push(`${envKey} balance check failed: ${errorMessage(error)}`);
  }
}

function sameAddress(left, right) {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
