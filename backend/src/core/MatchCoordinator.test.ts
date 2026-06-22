import assert from "node:assert/strict";
import { test } from "node:test";
import { SovereignBluff } from "../games/SovereignBluff.js";
import {
  MatchCoordinator,
  type ArchiveGateway,
  type PrizePoolGateway,
  type PrizePoolStatus,
} from "./MatchCoordinator.js";
import type { Player } from "./types.js";

const players: Player[] = [
  {
    id: "alpha",
    name: "Alpha",
    walletAddress: "0xalpha",
    agentKind: "mock",
  },
  {
    id: "beta",
    name: "Beta",
    walletAddress: "0xbeta",
    agentKind: "mock",
  },
];

function poolStatus(overrides: Partial<PrizePoolStatus> = {}): PrizePoolStatus {
  return {
    prizePoolAddress: "0xpool",
    stakeWei: "1000",
    totalPoolWei: "2000",
    rulesHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    fullyFunded: true,
    paid: false,
    fundingTxHashes: [
      {
        playerId: "alpha",
        walletAddress: "0xalpha",
        txHash: "0xfundalpha",
        amountWei: "1000",
      },
      {
        playerId: "beta",
        walletAddress: "0xbeta",
        txHash: "0xfundbeta",
        amountWei: "1000",
      },
    ],
    ...overrides,
  };
}

function coordinator(input: {
  pool?: PrizePoolGateway;
  archive?: ArchiveGateway;
} = {}): MatchCoordinator {
  return new MatchCoordinator({
    engines: [new SovereignBluff()],
    archive:
      input.archive ??
      ({
        mode: "mock",
        async archiveMatch() {
          return { archiveHash: "mock-0g-archive", url: "mock://archive" };
        },
      } satisfies ArchiveGateway),
    prizePool:
      input.pool ??
      ({
        mode: "contract",
        async getPool() {
          return poolStatus({ paid: true });
        },
        async payoutWinner() {
          return { txHash: "0xpayout", amountWei: "2000", status: "paid" };
        },
      } satisfies PrizePoolGateway),
    rulebook: {
      rulesHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      rulesUrl: "0g://rulebook",
      rulesVersion: "1.0.0",
    },
    idFactory: () => "match_test",
    now: () => new Date("2026-06-22T00:00:00.000Z"),
  });
}

async function playFiveRounds(subject: MatchCoordinator): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    await subject.submitMove("match_test", "alpha", {
      phase: "broadcast",
      message: "Alpha",
    });
    await subject.submitMove("match_test", "beta", {
      phase: "broadcast",
      message: "Beta",
    });
    await subject.submitMove("match_test", "alpha", { phase: "bid", amount: 1 });
    await subject.submitMove("match_test", "beta", { phase: "bid", amount: 2 });
  }
}

test("coordinator cannot activate a match before prize pool is fully funded", async () => {
  const subject = coordinator({
    pool: {
      mode: "contract",
      async getPool() {
        return poolStatus({ fullyFunded: false, fundingTxHashes: [] });
      },
      async payoutWinner() {
        return { txHash: "0xpayout", amountWei: "2000", status: "paid" };
      },
    },
  });
  subject.createMatch("sovereign-bluff", players);

  await assert.rejects(
    () => subject.activateMatch("match_test"),
    /Prize pool is not fully funded/,
  );
});

test("coordinator stores a final receipt after archive and payout", async () => {
  const subject = coordinator();
  subject.createMatch("sovereign-bluff", players);
  await subject.activateMatch("match_test");
  await playFiveRounds(subject);

  const match = subject.getMatch("match_test");
  const receipt = subject.getReceipt("match_test");

  assert.equal(match?.status, "paid");
  assert.equal(receipt?.archiveHash, "mock-0g-archive");
  assert.equal(receipt?.rulesHash, "0x1111111111111111111111111111111111111111111111111111111111111111");
  assert.equal(receipt?.rulesUrl, "0g://rulebook");
  assert.equal(receipt?.rulesVersion, "1.0.0");
  assert.equal(receipt?.prizePoolAddress, "0xpool");
  assert.equal(receipt?.fundingTxHashes.length, 2);
  assert.equal(receipt?.winnerWalletAddress, "0xbeta");
  assert.equal(receipt?.payoutAmountWei, "2000");
  assert.equal(receipt?.payoutTxHash, "0xpayout");
  assert.equal(receipt?.agentInference.length, 2);
});

test("coordinator refuses final receipt without archive hash", async () => {
  const subject = coordinator({
    archive: {
      mode: "mock",
      async archiveMatch() {
        return { archiveHash: "" };
      },
    },
  });
  subject.createMatch("sovereign-bluff", players);
  await subject.activateMatch("match_test");

  await assert.rejects(() => playFiveRounds(subject), /archive hash/i);
});

test("coordinator refuses final receipt when prize pool rules hash mismatches", async () => {
  const subject = coordinator({
    pool: {
      mode: "contract",
      async getPool() {
        return poolStatus({
          paid: true,
          rulesHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
        });
      },
      async payoutWinner() {
        return { txHash: "0xpayout", amountWei: "2000", status: "paid" };
      },
    },
  });
  subject.createMatch("sovereign-bluff", players);
  await subject.activateMatch("match_test");

  await assert.rejects(() => playFiveRounds(subject), /rulesHash/i);
});

test("coordinator refuses final receipt without funding transaction hashes", async () => {
  const subject = coordinator({
    pool: {
      mode: "contract",
      async getPool() {
        return poolStatus({ fundingTxHashes: [] });
      },
      async payoutWinner() {
        return { txHash: "0xpayout", amountWei: "2000", status: "paid" };
      },
    },
  });
  subject.createMatch("sovereign-bluff", players);

  await assert.rejects(() => subject.activateMatch("match_test"), /funding transactions/);
});

test("coordinator refuses final receipt without payout amount or payout tx hash", async () => {
  const subject = coordinator({
    pool: {
      mode: "contract",
      async getPool() {
        return poolStatus({ paid: true });
      },
      async payoutWinner() {
        return { txHash: "", amountWei: "", status: "paid" };
      },
    },
  });
  subject.createMatch("sovereign-bluff", players);
  await subject.activateMatch("match_test");

  await assert.rejects(() => playFiveRounds(subject), /payout amount|payout transaction/i);
});
