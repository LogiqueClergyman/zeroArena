import { expect } from "chai";
import { ethers } from "hardhat";

describe("PrizePool", function () {
  async function deployFixture() {
    const [owner, alpha, beta, outsider] = await ethers.getSigners();
    const PrizePool = await ethers.getContractFactory("PrizePool");
    const prizePool = await PrizePool.deploy();
    const matchId = ethers.id("match_test");
    const stake = 1000n;
    const rulesHash = ethers.keccak256(ethers.toUtf8Bytes("sovereign-bluff.v1"));
    await prizePool.createMatch(matchId, [alpha.address, beta.address], stake, rulesHash);
    return { prizePool, owner, alpha, beta, outsider, matchId, stake, rulesHash };
  }

  it("requires a non-zero rules hash when creating a match", async function () {
    const [, alpha, beta] = await ethers.getSigners();
    const PrizePool = await ethers.getContractFactory("PrizePool");
    const prizePool = await PrizePool.deploy();

    await expect(
      prizePool.createMatch(ethers.id("match_zero_rules"), [alpha.address, beta.address], 1000n, ethers.ZeroHash),
    ).to.be.revertedWith("zero rules hash");
  });

  it("stores the expected rules hash for a created match", async function () {
    const { prizePool, matchId, rulesHash } = await deployFixture();
    const matchData = await prizePool.matches(matchId);

    expect(matchData.rulesHash).to.equal(rulesHash);
  });

  it("creates a match and accepts exact one-time player funding", async function () {
    const { prizePool, alpha, beta, outsider, matchId, stake } = await deployFixture();

    await expect(prizePool.connect(outsider).fund(matchId, { value: stake })).to.be.revertedWith(
      "not player",
    );
    await expect(prizePool.connect(alpha).fund(matchId, { value: stake + 1n })).to.be.revertedWith(
      "wrong stake",
    );
    await expect(prizePool.connect(alpha).fund(matchId, { value: stake }))
      .to.emit(prizePool, "Funded")
      .withArgs(matchId, alpha.address, stake);
    await expect(prizePool.connect(alpha).fund(matchId, { value: stake })).to.be.revertedWith(
      "already funded",
    );
    await prizePool.connect(beta).fund(matchId, { value: stake });

    expect(await prizePool.isFullyFunded(matchId)).to.equal(true);
  });

  it("refuses early payout before full funding", async function () {
    const { prizePool, alpha, matchId, stake } = await deployFixture();
    await prizePool.connect(alpha).fund(matchId, { value: stake });

    await expect(
      prizePool.payout(matchId, alpha.address, ethers.keccak256(ethers.toUtf8Bytes("archive"))),
    ).to.be.revertedWith("not fully funded");
  });

  it("pays the listed winner after full funding", async function () {
    const { prizePool, alpha, beta, outsider, matchId, stake } = await deployFixture();
    await prizePool.connect(alpha).fund(matchId, { value: stake });
    await prizePool.connect(beta).fund(matchId, { value: stake });
    const storageHash = ethers.keccak256(ethers.toUtf8Bytes("archive"));

    await expect(prizePool.payout(matchId, outsider.address, storageHash)).to.be.revertedWith(
      "winner not player",
    );
    await expect(() => prizePool.payout(matchId, alpha.address, storageHash)).to.changeEtherBalance(
      alpha,
      stake * 2n,
    );
  });
});
