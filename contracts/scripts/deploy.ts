import { ethers, network } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const PrizePool = await ethers.getContractFactory("PrizePool");
  const prizePool = await PrizePool.deploy();
  const deployment = await prizePool.waitForDeployment();
  const address = await prizePool.getAddress();
  const tx = deployment.deploymentTransaction();

  console.log(`network=${network.name}`);
  console.log(`chainId=${network.config.chainId}`);
  console.log(`deployer=${deployer.address}`);
  console.log(`prizePool=${address}`);
  console.log(`deploymentTx=${tx?.hash ?? ""}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
