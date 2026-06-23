import { runRealInferenceSovereignBluffE2E } from "../testing/realInferenceSovereignBluffHarness.js";

const result = await runRealInferenceSovereignBluffE2E();

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
