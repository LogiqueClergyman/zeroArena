import { ethers, network } from "hardhat";

async function main() {
  const addresses = [
    ["deployer", process.env.DEPLOYER_ADDRESS],
    ["agentAlpha", process.env.AGENT_ALPHA_WALLET_ADDRESS],
    ["agentBeta", process.env.AGENT_BETA_WALLET_ADDRESS],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  console.log(`network=${network.name}`);
  console.log(`chainId=${network.config.chainId}`);
  for (const [label, address] of addresses) {
    const balance = await ethers.provider.getBalance(address);
    console.log(`${label}=${address} balanceWei=${balance.toString()}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
