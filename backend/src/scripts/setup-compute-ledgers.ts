import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { config as loadEnv } from "dotenv";
import { ethers } from "ethers";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env") });

interface AgentWalletConfig {
  label: string;
  walletAddress: string;
  privateKey: string;
}

const minimumNewLedgerBalanceOg = 3;

async function main() {
  const rpcUrl = process.env.ZERO_G_EVM_RPC_URL ?? process.env.EVM_RPC_URL;
  if (!rpcUrl) {
    throw new Error("ZERO_G_EVM_RPC_URL or EVM_RPC_URL is required");
  }

  const amountOg = Number(process.env.ZERO_G_COMPUTE_LEDGER_CREATE_AMOUNT ?? minimumNewLedgerBalanceOg);
  if (!Number.isFinite(amountOg) || amountOg < minimumNewLedgerBalanceOg) {
    throw new Error(
      `ZERO_G_COMPUTE_LEDGER_CREATE_AMOUNT must be at least ${minimumNewLedgerBalanceOg} for new 0G Compute ledgers`,
    );
  }

  const agents: AgentWalletConfig[] = [
    {
      label: "Alpha",
      walletAddress: requiredEnv("AGENT_ALPHA_WALLET_ADDRESS"),
      privateKey: requiredEnv("AGENT_ALPHA_PRIVATE_KEY"),
    },
    {
      label: "Beta",
      walletAddress: requiredEnv("AGENT_BETA_WALLET_ADDRESS"),
      privateKey: requiredEnv("AGENT_BETA_PRIVATE_KEY"),
    },
  ];

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  console.log(`networkChainId=${network.chainId}`);
  console.log(`ledgerCreateAmountOg=${amountOg}`);

  for (const agent of agents) {
    await setupAgentLedger(provider, agent, amountOg);
  }
}

async function setupAgentLedger(
  provider: ethers.JsonRpcProvider,
  agent: AgentWalletConfig,
  amountOg: number,
): Promise<void> {
  const wallet = new ethers.Wallet(agent.privateKey, provider);
  const signerAddress = await wallet.getAddress();
  if (ethers.getAddress(signerAddress) !== ethers.getAddress(agent.walletAddress)) {
    throw new Error(`${agent.label} private key does not match ${agent.walletAddress}`);
  }

  const nativeBalance = await provider.getBalance(signerAddress);
  console.log(`${agent.label} wallet=${signerAddress} nativeBalanceOg=${ethers.formatEther(nativeBalance)}`);

  const broker = await createZGComputeNetworkBroker(wallet as never);
  try {
    const ledger = await broker.ledger.getLedger();
    console.log(
      `${agent.label} computeLedger=exists totalOg=${formatOg(ledger.totalBalance)} availableOg=${formatOg(
        ledger.availableBalance,
      )}`,
    );
    return;
  } catch (error) {
    if (!isMissingAccountError(error)) {
      throw error;
    }
  }

  const requiredWei = ethers.parseEther(String(amountOg));
  if (nativeBalance <= requiredWei) {
    throw new Error(
      `${agent.label} needs more than ${amountOg} native 0G to create a Compute ledger and pay gas; current balance is ${ethers.formatEther(
        nativeBalance,
      )}`,
    );
  }

  console.log(`${agent.label} computeLedger=missing action=creating`);
  await broker.ledger.addLedger(amountOg);
  const ledger = await broker.ledger.getLedger();
  console.log(
    `${agent.label} computeLedger=created totalOg=${formatOg(ledger.totalBalance)} availableOg=${formatOg(
      ledger.availableBalance,
    )}`,
  );
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function isMissingAccountError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("account does not exist");
}

function formatOg(value: bigint): string {
  return ethers.formatEther(value);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
