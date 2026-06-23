import { runLocalSovereignBluffE2E } from "../testing/localSovereignBluffHarness.js";

const result = await runLocalSovereignBluffE2E();

console.log(
  JSON.stringify(
    {
      matchId: result.matchId,
      winner: result.winner,
      roundsCompleted: result.roundsCompleted,
      receipt: result.receipt,
    },
    null,
    2,
  ),
);
