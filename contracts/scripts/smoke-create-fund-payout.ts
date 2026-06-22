import { ethers, network } from "hardhat";

const ABI = [
  "function createMatch(bytes32 matchId,address[] players,uint256 requiredStake,bytes32 rulesHash)",
  "function fund(bytes32 matchId) payable",
  "function isFullyFunded(bytes32 matchId) view returns (bool)",
  "function payout(bytes32 matchId,address winner,bytes32 storageHash)",
];

async function main() {
  const required = [
    "PRIZE_POOL_ADDRESS",
    "AGENT_ALPHA_PRIVATE_KEY",
    "AGENT_BETA_PRIVATE_KEY",
    "MATCH_STAKE_WEI",
    "SOVEREIGN_BLUFF_RULEBOOK_HASH",
  ].filter((key) => !process.env[key]);
  if (required.length) {
    throw new Error(`Missing env: ${required.join(", ")}`);
  }

  const [operator] = await ethers.getSigners();
  const alpha = new ethers.Wallet(process.env.AGENT_ALPHA_PRIVATE_KEY!, ethers.provider);
  const beta = new ethers.Wallet(process.env.AGENT_BETA_PRIVATE_KEY!, ethers.provider);
  const stake = BigInt(process.env.MATCH_STAKE_WEI!);
  const matchIdText = `smoke_${Date.now()}`;
  const matchId = ethers.id(matchIdText);
  const storageHash = ethers.keccak256(ethers.toUtf8Bytes(`storage:${matchIdText}`));
  const rulesHash = process.env.SOVEREIGN_BLUFF_RULEBOOK_HASH!;
  const contract = new ethers.Contract(process.env.PRIZE_POOL_ADDRESS!, ABI, operator);

  const winnerBefore = await ethers.provider.getBalance(alpha.address);
  const createTx = await contract.createMatch(matchId, [alpha.address, beta.address], stake, rulesHash);
  await createTx.wait();
  const alphaFundTx = await contract.connect(alpha).fund(matchId, { value: stake });
  await alphaFundTx.wait();

  try {
    await contract.payout(matchId, alpha.address, storageHash);
    throw new Error("early payout unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("not fully funded")) {
      throw error;
    }
  }

  const betaFundTx = await contract.connect(beta).fund(matchId, { value: stake });
  await betaFundTx.wait();
  const fullyFunded = await contract.isFullyFunded(matchId);
  if (!fullyFunded) {
    throw new Error("pool is not fully funded after both funding transactions");
  }
  const payoutTx = await contract.payout(matchId, alpha.address, storageHash);
  await payoutTx.wait();
  const winnerAfter = await ethers.provider.getBalance(alpha.address);

  console.log(`network=${network.name}`);
  console.log(`chainId=${network.config.chainId}`);
  console.log(`matchId=${matchIdText}`);
  console.log(`prizePool=${process.env.PRIZE_POOL_ADDRESS}`);
  console.log(`matchStakeWei=${stake}`);
  console.log(`createTx=${createTx.hash}`);
  console.log(`alphaFundTx=${alphaFundTx.hash}`);
  console.log(`betaFundTx=${betaFundTx.hash}`);
  console.log(`storageHash=${storageHash}`);
  console.log(`rulesHash=${rulesHash}`);
  console.log(`payoutWei=${stake * 2n}`);
  console.log(`payoutTx=${payoutTx.hash}`);
  console.log(`winner=${alpha.address}`);
  console.log(`winnerBeforeWei=${winnerBefore}`);
  console.log(`winnerAfterWei=${winnerAfter}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
