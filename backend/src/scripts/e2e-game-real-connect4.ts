import { runRealInferenceConnect4E2E } from "../testing/realInferenceConnect4Harness.js";

const result = await runRealInferenceConnect4E2E();

console.log(
  JSON.stringify(
    {
      matchId: result.matchId,
      outcome: result.outcome,
      winner: result.winner,
      movesCompleted: result.movesCompleted,
      receipt: result.receipt,
    },
    null,
    2,
  ),
);
