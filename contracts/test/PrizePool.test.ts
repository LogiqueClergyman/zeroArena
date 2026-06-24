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

  it("refunds a draw to both funded players and emits refund events", async function () {
    const { prizePool, alpha, beta, matchId, stake } = await deployFixture();
    await prizePool.connect(alpha).fund(matchId, { value: stake });
    await prizePool.connect(beta).fund(matchId, { value: stake });
    const storageHash = ethers.keccak256(ethers.toUtf8Bytes("draw archive"));

    await expect(() => prizePool.refundDraw(matchId, storageHash)).to.changeEtherBalances(
      [alpha, beta],
      [stake, stake],
    );
    await expect(prizePool.refundDraw(matchId, storageHash)).to.be.revertedWith(
      "already finalized",
    );
  });

  it("emits MatchRefunded and PlayerRefunded for a draw", async function () {
    const { prizePool, alpha, beta, matchId, stake } = await deployFixture();
    await prizePool.connect(alpha).fund(matchId, { value: stake });
    await prizePool.connect(beta).fund(matchId, { value: stake });
    const storageHash = ethers.keccak256(ethers.toUtf8Bytes("draw archive"));

    await expect(prizePool.refundDraw(matchId, storageHash))
      .to.emit(prizePool, "MatchRefunded")
      .withArgs(matchId, storageHash)
      .and.to.emit(prizePool, "PlayerRefunded")
      .withArgs(matchId, alpha.address, stake)
      .and.to.emit(prizePool, "PlayerRefunded")
      .withArgs(matchId, beta.address, stake);
  });

  it("cannot refund before full funding", async function () {
    const { prizePool, alpha, matchId, stake } = await deployFixture();
    await prizePool.connect(alpha).fund(matchId, { value: stake });

    await expect(
      prizePool.refundDraw(matchId, ethers.keccak256(ethers.toUtf8Bytes("archive"))),
    ).to.be.revertedWith("not fully funded");
  });

  it("cannot payout after refund or refund after payout", async function () {
    const { prizePool, alpha, beta, matchId, stake } = await deployFixture();
    await prizePool.connect(alpha).fund(matchId, { value: stake });
    await prizePool.connect(beta).fund(matchId, { value: stake });
    const storageHash = ethers.keccak256(ethers.toUtf8Bytes("archive"));

    await prizePool.refundDraw(matchId, storageHash);
    await expect(prizePool.payout(matchId, alpha.address, storageHash)).to.be.revertedWith(
      "already finalized",
    );

    const nextMatchId = ethers.id("match_paid_first");
    await prizePool.createMatch(nextMatchId, [alpha.address, beta.address], stake, ethers.id("rules"));
    await prizePool.connect(alpha).fund(nextMatchId, { value: stake });
    await prizePool.connect(beta).fund(nextMatchId, { value: stake });
    await prizePool.payout(nextMatchId, alpha.address, storageHash);
    await expect(prizePool.refundDraw(nextMatchId, storageHash)).to.be.revertedWith(
      "already finalized",
    );
  });

  it("rejects zero storage hash for payout and draw refund", async function () {
    const { prizePool, alpha, beta, matchId, stake } = await deployFixture();
    await prizePool.connect(alpha).fund(matchId, { value: stake });
    await prizePool.connect(beta).fund(matchId, { value: stake });

    await expect(prizePool.refundDraw(matchId, ethers.ZeroHash)).to.be.revertedWith(
      "zero storage hash",
    );
    await expect(prizePool.payout(matchId, alpha.address, ethers.ZeroHash)).to.be.revertedWith(
      "zero storage hash",
    );
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
